import crypto from 'node:crypto'

import type { ToolExecutionResult } from '../cc/manager.js'
import type { AgentMention, OrchestrationMetadata, ServerMsg, ToolAgentInfo, VibeToolInfo } from '../types/index.js'

type UserMessage = Extract<ServerMsg, { type: 'user' }>
type PublicTextMessage = Extract<ServerMsg, { type: 'text' }>

interface MentionConversationManager {
  isRunning(): boolean
  start(
    projectDir: string,
    inputText: string,
    tool: VibeToolInfo['id'],
    options?: {
      requestedAgentName?: string | null
      requestedAgentLabel?: string | null
      preamble?: string
    },
  ): Promise<ToolExecutionResult>
}

interface MentionConversationContext {
  sessionId: string
  projectDir: string
  text: string
  mentions: AgentMention[]
  tool: VibeToolInfo
  manager: MentionConversationManager
  onUserMessage: (message: UserMessage) => void
  savePublicMessage: (message: PublicTextMessage) => void
  publish: (message: PublicTextMessage) => void
}

interface ResolvedMentions {
  leadAgent: ToolAgentInfo
  collaboratorAgents: ToolAgentInfo[]
}

interface CollaboratorReply {
  agent: ToolAgentInfo
  reply: string
}

const MAX_MENTIONED_AGENTS = 3

export async function runMentionConversation(context: MentionConversationContext): Promise<ToolExecutionResult> {
  const validation = validateMentions(context.tool, context.mentions)
  if (!validation.ok) {
    return createFailureResult(context.tool.id, validation.errorMessage)
  }

  if (context.manager.isRunning()) {
    return createFailureResult(context.tool.id, 'Another tool execution is already in progress.')
  }

  emitUserMessage(context)

  const { leadAgent, collaboratorAgents } = validation

  if (!collaboratorAgents.length) {
    const leadResult = await context.manager.start(
      context.projectDir,
      context.text,
      context.tool.id,
      {
        requestedAgentName: leadAgent.name,
        requestedAgentLabel: leadAgent.name,
        preamble: buildLeadAgentPreamble(context.tool, leadAgent),
      },
    )

    if (!leadResult.ok) return leadResult

    const summary = getUsableAssistantText(leadResult)
    if (summary) {
      emitPublicMessage(context, {
        type: 'text',
        content: summary,
        messageId: crypto.randomUUID(),
        ...buildMetadata(leadAgent, userTarget, 'agent_to_user'),
      })
    }

    return { ...leadResult, assistantText: summary || leadResult.assistantText }
  }

  const collaboratorReplies: CollaboratorReply[] = []

  for (const collaborator of collaboratorAgents) {
    emitPublicMessage(context, {
      type: 'text',
      content: buildLeadQuestion(context.text, collaborator),
      messageId: crypto.randomUUID(),
      ...buildMetadata(leadAgent, collaborator, 'agent_to_agent'),
    })

    const collaboratorResult = await context.manager.start(
      context.projectDir,
      context.text,
      context.tool.id,
      {
        requestedAgentName: collaborator.name,
        requestedAgentLabel: collaborator.name,
        preamble: buildCollaboratorPreamble(context.tool, leadAgent, collaborator, context.text),
      },
    )

    const reply = getUsableAssistantText(collaboratorResult) || buildCollaboratorFallbackReply(collaborator)
    collaboratorReplies.push({ agent: collaborator, reply })

    emitPublicMessage(context, {
      type: 'text',
      content: reply,
      messageId: crypto.randomUUID(),
      ...buildMetadata(collaborator, leadAgent, 'agent_reply'),
    })
  }

  const leadResult = await context.manager.start(
    context.projectDir,
    context.text,
    context.tool.id,
    {
      requestedAgentName: leadAgent.name,
      requestedAgentLabel: leadAgent.name,
      preamble: buildLeadSummaryPreamble(context.tool, leadAgent, context.text, collaboratorReplies),
    },
  )

  if (!leadResult.ok) return leadResult

  const summary = getUsableAssistantText(leadResult)
  if (!summary) {
    return createFailureResult(context.tool.id, `${leadAgent.name} did not provide a usable reply.`)
  }

  emitPublicMessage(context, {
    type: 'text',
    content: summary,
    messageId: crypto.randomUUID(),
    ...buildMetadata(leadAgent, userTarget, 'agent_to_user'),
  })

  return { ...leadResult, assistantText: summary }
}

function validateMentions(tool: VibeToolInfo, mentions: AgentMention[]): ({ ok: true } & ResolvedMentions) | { ok: false; errorMessage: string } {
  if (!mentions.length) {
    return { ok: false, errorMessage: 'At least one mentioned agent is required.' }
  }

  if (mentions.length > MAX_MENTIONED_AGENTS) {
    return { ok: false, errorMessage: 'At most 3 agents can participate in a single mention conversation.' }
  }

  const toolId = mentions[0].toolId
  if (mentions.some((mention) => mention.toolId !== toolId)) {
    return { ok: false, errorMessage: 'All mentioned agents must belong to the same CLI tool.' }
  }

  if (tool.id !== toolId) {
    return { ok: false, errorMessage: 'The selected CLI tool does not match the mentioned agents.' }
  }

  const leadAgent = resolveAgent(tool, mentions[0])
  if (!leadAgent) {
    return { ok: false, errorMessage: `Unable to resolve agent ${mentions[0].name}.` }
  }

  const collaboratorAgents = mentions.slice(1).map((mention) => resolveAgent(tool, mention))
  if (collaboratorAgents.some((agent) => !agent)) {
    return { ok: false, errorMessage: 'One or more mentioned agents could not be resolved for the current CLI.' }
  }

  return {
    ok: true,
    leadAgent,
    collaboratorAgents: collaboratorAgents as ToolAgentInfo[],
  }
}

function resolveAgent(tool: VibeToolInfo, mention: AgentMention) {
  return tool.agents.find((agent) => agent.id === mention.agentId || agent.name === mention.name) || null
}

function emitUserMessage(context: MentionConversationContext) {
  context.onUserMessage({
    type: 'user',
    content: context.text,
    messageId: crypto.randomUUID(),
    senderType: 'user',
    orchestrationStep: 'user_request',
  })
}

function emitPublicMessage(context: MentionConversationContext, message: PublicTextMessage) {
  context.savePublicMessage(message)
  void context.publish
}

function buildMetadata(
  sender: Pick<ToolAgentInfo, 'id' | 'name'>,
  target: Pick<ToolAgentInfo, 'id' | 'name'>,
  orchestrationStep: OrchestrationMetadata['orchestrationStep'],
): OrchestrationMetadata {
  return {
    senderType: 'agent',
    senderAgentId: sender.id,
    senderAgentName: sender.name,
    targetAgentId: target.id,
    targetAgentName: target.name,
    orchestrationStep,
  }
}

function buildLeadQuestion(userText: string, collaborator: ToolAgentInfo) {
  return `@${collaborator.name} please share the most relevant context for: ${userText}`
}

function buildLeadAgentPreamble(tool: VibeToolInfo, leadAgent: ToolAgentInfo) {
  return [
    `You are the ${leadAgent.name} agent running in ${tool.label}.`,
    leadAgent.description ? `Role: ${leadAgent.description}` : '',
    'Reply directly to the end user.',
    'Do not delegate unless the user explicitly mentioned collaborators.',
  ].filter(Boolean).join('\n')
}

function buildCollaboratorPreamble(
  tool: VibeToolInfo,
  leadAgent: ToolAgentInfo,
  collaborator: ToolAgentInfo,
  userText: string,
) {
  return [
    `You are the ${collaborator.name} agent running in ${tool.label}.`,
    collaborator.description ? `Role: ${collaborator.description}` : '',
    `Lead agent: ${leadAgent.name}.`,
    `User request: ${userText}`,
    `Reply to ${leadAgent.name} with a concise update they can quote or summarize.`,
    'Do not address the end user directly.',
  ].filter(Boolean).join('\n')
}

function buildLeadSummaryPreamble(
  tool: VibeToolInfo,
  leadAgent: ToolAgentInfo,
  userText: string,
  collaboratorReplies: CollaboratorReply[],
) {
  const summaries = collaboratorReplies
    .map((reply) => `- ${reply.agent.name}: ${reply.reply}`)
    .join('\n')

  return [
    `You are the ${leadAgent.name} agent running in ${tool.label}.`,
    leadAgent.description ? `Role: ${leadAgent.description}` : '',
    `User request: ${userText}`,
    'Collaborator replies:',
    summaries || '- No collaborator replies were available.',
    'Respond directly to the end user with a final summary.',
  ].filter(Boolean).join('\n')
}

function buildCollaboratorFallbackReply(collaborator: ToolAgentInfo) {
  return `${collaborator.name} did not provide a usable reply.`
}

function getUsableAssistantText(result: Pick<ToolExecutionResult, 'ok' | 'assistantText'>) {
  if (!result.ok) return ''
  return result.assistantText?.trim() || ''
}

function createFailureResult(tool: VibeToolInfo['id'], errorMessage: string): ToolExecutionResult {
  return {
    ok: false,
    tool,
    producedOutput: false,
    recoverable: false,
    errorMessage,
  }
}

const userTarget = {
  id: 'user',
  name: 'user',
} as const
