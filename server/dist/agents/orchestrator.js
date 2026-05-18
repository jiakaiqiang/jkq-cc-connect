import crypto from 'node:crypto';
const MAX_MENTIONED_AGENTS = 3;
export async function runMentionConversation(context) {
    const validation = validateMentionConversationRequest({
        mentions: context.mentions,
        tools: [context.tool],
        expectedToolId: context.tool.id,
    });
    if (!validation.ok) {
        return createFailureResult(context.tool.id, validation.errorMessage);
    }
    if (context.manager.isRunning()) {
        return createFailureResult(context.tool.id, 'Another tool execution is already in progress.');
    }
    emitUserMessage(context);
    const { leadAgent, collaboratorAgents } = validation;
    if (!collaboratorAgents.length) {
        const leadResult = await context.manager.start(context.projectDir, context.text, context.tool.id, {
            requestedAgentName: leadAgent.name,
            requestedAgentLabel: leadAgent.name,
            preamble: buildLeadAgentPreamble(context.tool, leadAgent),
            suppressAssistantMessageBroadcast: true,
        });
        const summary = getUsableAssistantText(leadResult);
        if (!summary) {
            if (!leadResult.ok)
                return leadResult;
            return createFailureResult(context.tool.id, `${leadAgent.name} did not provide a usable reply.`);
        }
        emitPublicMessage(context, {
            type: 'text',
            content: summary,
            messageId: crypto.randomUUID(),
            ...buildMetadata(leadAgent, userTarget, 'agent_to_user'),
        });
        return { ...leadResult, assistantText: summary };
    }
    const collaboratorReplies = [];
    for (const collaborator of collaboratorAgents) {
        emitPublicMessage(context, {
            type: 'text',
            content: buildLeadQuestion(context.text, collaborator),
            messageId: crypto.randomUUID(),
            ...buildMetadata(leadAgent, collaborator, 'agent_to_agent'),
        });
        const collaboratorResult = await context.manager.start(context.projectDir, context.text, context.tool.id, {
            requestedAgentName: collaborator.name,
            requestedAgentLabel: collaborator.name,
            preamble: buildCollaboratorPreamble(context.tool, leadAgent, collaborator, context.text),
            suppressAssistantMessageBroadcast: true,
        });
        const reply = getUsableAssistantText(collaboratorResult) || buildCollaboratorFallbackReply(collaborator);
        collaboratorReplies.push({ agent: collaborator, reply });
        emitPublicMessage(context, {
            type: 'text',
            content: reply,
            messageId: crypto.randomUUID(),
            ...buildMetadata(collaborator, leadAgent, 'agent_reply'),
        });
    }
    const leadResult = await context.manager.start(context.projectDir, context.text, context.tool.id, {
        requestedAgentName: leadAgent.name,
        requestedAgentLabel: leadAgent.name,
        preamble: buildLeadSummaryPreamble(context.tool, leadAgent, context.text, collaboratorReplies),
        suppressAssistantMessageBroadcast: true,
    });
    const summary = getUsableAssistantText(leadResult);
    if (!summary) {
        if (!leadResult.ok)
            return leadResult;
        return createFailureResult(context.tool.id, `${leadAgent.name} did not provide a usable reply.`);
    }
    emitPublicMessage(context, {
        type: 'text',
        content: summary,
        messageId: crypto.randomUUID(),
        ...buildMetadata(leadAgent, userTarget, 'agent_to_user'),
    });
    return { ...leadResult, assistantText: summary };
}
export function validateMentionConversationRequest({ mentions, tools, expectedToolId, requireExecutable = false, }) {
    const normalizedMentions = [...mentions].sort((left, right) => left.order - right.order);
    if (!normalizedMentions.length) {
        return { ok: false, errorMessage: 'At least one mentioned agent is required.' };
    }
    if (normalizedMentions.length > MAX_MENTIONED_AGENTS) {
        return { ok: false, errorMessage: 'At most 3 agents can participate in a single mention conversation.' };
    }
    const toolId = normalizedMentions[0].toolId;
    if (normalizedMentions.some((mention) => mention.toolId !== toolId)) {
        return { ok: false, errorMessage: 'All mentioned agents must belong to the same CLI tool.' };
    }
    if (expectedToolId && expectedToolId !== toolId) {
        return { ok: false, errorMessage: 'The selected CLI tool does not match the mentioned agents.' };
    }
    const tool = tools.find((candidate) => candidate.id === toolId);
    if (!tool) {
        return { ok: false, errorMessage: 'The selected CLI tool is not currently available.' };
    }
    if (requireExecutable && !tool.supportsExecution) {
        return { ok: false, errorMessage: tool.detail || 'The selected CLI tool is not currently available.' };
    }
    const leadAgent = resolveAgent(tool, normalizedMentions[0]);
    if (!leadAgent) {
        return { ok: false, errorMessage: `Unable to resolve agent ${normalizedMentions[0].name}.` };
    }
    const collaboratorAgents = normalizedMentions.slice(1).map((mention) => resolveAgent(tool, mention));
    if (collaboratorAgents.some((agent) => !agent)) {
        return { ok: false, errorMessage: 'One or more mentioned agents could not be resolved for the current CLI.' };
    }
    return {
        ok: true,
        tool,
        leadAgent,
        collaboratorAgents: collaboratorAgents,
    };
}
function resolveAgent(tool, mention) {
    return tool.agents.find((agent) => agent.id === mention.agentId || agent.name === mention.name) || null;
}
function emitUserMessage(context) {
    context.onUserMessage({
        type: 'user',
        content: context.text,
        messageId: crypto.randomUUID(),
        senderType: 'user',
        orchestrationStep: 'user_request',
    });
}
function emitPublicMessage(context, message) {
    context.savePublicMessage(message);
    context.publish(message);
}
function buildMetadata(sender, target, orchestrationStep) {
    return {
        senderType: 'agent',
        senderAgentId: sender.id,
        senderAgentName: sender.name,
        targetAgentId: target.id,
        targetAgentName: target.name,
        orchestrationStep,
    };
}
function buildLeadQuestion(userText, collaborator) {
    return `@${collaborator.name} please share the most relevant context for: ${userText}`;
}
function buildLeadAgentPreamble(tool, leadAgent) {
    return [
        `You are the ${leadAgent.name} agent running in ${tool.label}.`,
        leadAgent.description ? `Role: ${leadAgent.description}` : '',
        'Reply directly to the end user.',
        'Do not delegate unless the user explicitly mentioned collaborators.',
    ].filter(Boolean).join('\n');
}
function buildCollaboratorPreamble(tool, leadAgent, collaborator, userText) {
    return [
        `You are the ${collaborator.name} agent running in ${tool.label}.`,
        collaborator.description ? `Role: ${collaborator.description}` : '',
        `Lead agent: ${leadAgent.name}.`,
        `User request: ${userText}`,
        `Reply to ${leadAgent.name} with a concise update they can quote or summarize.`,
        'Do not address the end user directly.',
    ].filter(Boolean).join('\n');
}
function buildLeadSummaryPreamble(tool, leadAgent, userText, collaboratorReplies) {
    const summaries = collaboratorReplies
        .map((reply) => `- ${reply.agent.name}: ${reply.reply}`)
        .join('\n');
    return [
        `You are the ${leadAgent.name} agent running in ${tool.label}.`,
        leadAgent.description ? `Role: ${leadAgent.description}` : '',
        `User request: ${userText}`,
        'Collaborator replies:',
        summaries || '- No collaborator replies were available.',
        'Respond directly to the end user with a final summary.',
    ].filter(Boolean).join('\n');
}
function buildCollaboratorFallbackReply(collaborator) {
    return `${collaborator.name} did not provide a usable reply.`;
}
function getUsableAssistantText(result) {
    return result.assistantText?.trim() || '';
}
function createFailureResult(tool, errorMessage) {
    return {
        ok: false,
        tool,
        producedOutput: false,
        recoverable: false,
        errorMessage,
    };
}
const userTarget = {
    id: 'user',
    name: 'user',
};
//# sourceMappingURL=orchestrator.js.map