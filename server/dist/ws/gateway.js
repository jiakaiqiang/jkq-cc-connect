import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config.js';
import { getConversationState, getSession, getToolSessionMap, setToolSessionId, touchSession, updateSessionNameFromFirstMessage, upsertConversationState, } from '../store/sessions.js';
import { refreshConversationStateFromRecentHistory } from '../store/conversation.js';
import { appendMessageContent, getRecentMessagesWindow, saveMessage } from '../store/messages.js';
import { CCManager } from '../cc/manager.js';
import { buildExecutionInput } from '../cc/context.js';
import { parseClientMessage, serializeServerMsg } from './protocol.js';
import { logger } from '../utils/logger.js';
import { getFallbackTools, getVibeTools, planToolRoute } from '../tools/vibe.js';
import { getSlashHelpText, parseSlashCommand } from '../commands/slash.js';
// WebSocket 层给前端的 source label 做最后一次兜底，
// 避免前端还要知道每个 tool id 应该显示成什么名字。
function getSourceLabel(source) {
    switch (source) {
        case 'claude':
            return 'Claude';
        case 'codex':
            return 'Codex';
        case 'opencode':
            return 'OpenCode';
        default:
            return '系统';
    }
}
export class WSGateway {
    // 一个 session 对应一个 CCManager；
    // clients 是所有已连接设备，managers 是每个会话背后真正跑 CLI 的执行器。
    wss;
    clients = new Set();
    managers = new Map();
    sessionModes = new Map();
    streamingMessages = new Map();
    init(httpServer) {
        this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
        this.wss.on('connection', (ws) => {
            const client = { ws, authenticated: false, alive: true, sessionId: null };
            this.clients.add(client);
            ws.on('message', (raw) => {
                try {
                    this.handleMessage(client, raw.toString());
                }
                catch (err) {
                    logger.error('WS message error:', err);
                }
            });
            ws.on('close', () => {
                this.clients.delete(client);
            });
            ws.on('pong', () => {
                client.alive = true;
            });
        });
        // 标准心跳：客户端每 30s 必须回应 pong，否则视为死连接。
        const interval = setInterval(() => {
            for (const client of this.clients) {
                if (!client.alive) {
                    client.ws.terminate();
                    this.clients.delete(client);
                    continue;
                }
                client.alive = false;
                client.ws.ping();
            }
        }, 30000);
        this.wss.on('close', () => clearInterval(interval));
        logger.info('WebSocket gateway initialized');
    }
    handleMessage(client, rawData) {
        const msg = parseClientMessage(rawData);
        if (!msg)
            return;
        // 这里严格按消息类型分流：
        // auth 只改连接态，join_session 只同步历史，input/confirm/cancel 才会触发真正执行。
        switch (msg.type) {
            case 'auth':
                try {
                    jwt.verify(msg.token, getConfig().jwtSecret);
                    client.authenticated = true;
                    this.sendToClient(client, { type: 'auth_ok', session: {} });
                }
                catch {
                    this.sendToClient(client, { type: 'auth_error', message: 'Invalid token' });
                }
                break;
            case 'join_session':
                if (!client.authenticated)
                    return;
                client.sessionId = msg.sessionId;
                this.sendSessionState(client, msg.sessionId);
                break;
            case 'set_mode':
                if (!client.authenticated)
                    return;
                this.setSessionMode(msg.sessionId, msg.mode);
                break;
            case 'input':
                if (!client.authenticated)
                    return;
                this.handleInput(msg.sessionId, msg.text, msg.mode, msg.mentions || []);
                break;
            case 'confirm':
                if (!client.authenticated || !msg.sessionId)
                    return;
                this.getManager(msg.sessionId)?.sendConfirm(msg.requestId, msg.allow);
                break;
            case 'cancel':
                if (!client.authenticated || !msg.sessionId)
                    return;
                this.getManager(msg.sessionId)?.cancel();
                break;
            case 'ping':
                this.sendToClient(client, { type: 'pong' });
                break;
        }
    }
    getManager(sessionId) {
        let manager = this.managers.get(sessionId);
        if (manager)
            return manager;
        // manager 按 session 懒创建，避免还没进入某个会话时就提前占进程资源。
        manager = new CCManager();
        manager.setBroadcast((msg) => this.handleCCMessage(sessionId, msg));
        manager.hydrateToolSessions(getToolSessionMap(sessionId));
        this.managers.set(sessionId, manager);
        return manager;
    }
    async handleInput(sessionId, text, mode, mentions = []) {
        const session = getSession(sessionId);
        if (!session)
            return;
        if (mode) {
            this.setSessionMode(session.id, mode);
        }
        // slash 命令优先级高于普通自然语言输入，
        // 因为它表达的是“明确要切工具/跑命令/展示帮助”的控制意图。
        const slash = parseSlashCommand(text);
        if (slash) {
            if (slash.kind === 'help') {
                const helpText = getSlashHelpText();
                saveMessage(session.id, 'text', helpText, { source: 'system', sourceLabel: getSourceLabel('system') });
                this.broadcast(session.id, {
                    type: 'text',
                    content: helpText,
                    messageId: crypto.randomUUID(),
                    source: 'system',
                    sourceLabel: getSourceLabel('system'),
                });
                return;
            }
            if (slash.kind === 'error') {
                this.broadcast(session.id, {
                    type: 'error',
                    message: slash.message,
                    source: 'system',
                    sourceLabel: getSourceLabel('system'),
                });
                return;
            }
            if (slash.kind === 'tool-command') {
                this.clearStreamingMessage(session.id);
                touchSession(session.id);
                const userMessage = saveMessage(session.id, 'user', text);
                const renamedSession = updateSessionNameFromFirstMessage(session.id, text);
                if (renamedSession) {
                    this.broadcast(session.id, { type: 'session_updated', session: renamedSession });
                }
                this.broadcast(session.id, { type: 'user', content: text, messageId: userMessage.id });
                const manager = this.getManager(session.id);
                if (manager.isRunning()) {
                    await manager.stop();
                }
                await manager.startCommand(session.projectDir, slash.tool, slash.args);
                return;
            }
            text = slash.prompt;
            mode = slash.mode || mode;
        }
        upsertConversationState(session.id, { currentGoal: text });
        const orderedMentions = mentions
            .slice()
            .sort((left, right) => left.order - right.order)
            .filter((mention, index, array) => array.findIndex(item => item.agentId === mention.agentId) === index);
        if (orderedMentions.length) {
            await this.handleMentionConversation(session, text, orderedMentions);
            return;
        }
        // 普通输入先经过工具路由器，决定这一轮由 Claude / Codex / OpenCode 谁来处理。
        const conversationState = getConversationState(session.id);
        const toolSessionMap = getToolSessionMap(session.id);
        const routePlan = planToolRoute(text, mode, getVibeTools(), {
            lastSuccessfulTool: conversationState.lastSuccessfulTool,
            availableSessionTools: Object.keys(toolSessionMap),
        });
        if (!routePlan.selectedTools.length || routePlan.blockedReason) {
            this.broadcast(sessionId, {
                type: 'error',
                message: routePlan.blockedReason || routePlan.summary,
                source: 'system',
                sourceLabel: getSourceLabel('system'),
            });
            return;
        }
        if (routePlan.mode === 'parallel') {
            this.broadcast(sessionId, {
                type: 'error',
                message: '并行执行还没有接入完成，请先选择单个工具。',
                source: 'system',
                sourceLabel: getSourceLabel('system'),
            });
            return;
        }
        this.clearStreamingMessage(session.id);
        touchSession(session.id);
        const userMessage = saveMessage(session.id, 'user', text);
        const renamedSession = updateSessionNameFromFirstMessage(session.id, text);
        if (renamedSession) {
            this.broadcast(session.id, { type: 'session_updated', session: renamedSession });
        }
        this.broadcast(session.id, { type: 'user', content: text, messageId: userMessage.id });
        const manager = this.getManager(session.id);
        if (manager.isRunning()) {
            // 当前设计是一条 session 同时只跑一个 CLI 任务，
            // 新请求来了就先停掉旧任务，避免多路输出互相污染。
            await manager.stop();
        }
        const tools = getVibeTools();
        await this.executeWithFallback(session.id, session.projectDir, text, routePlan.selectedTools[0], tools);
    }
    async handleMentionConversation(session, text, mentions) {
        if (!session)
            return;
        if (mentions.length > 3) {
            this.broadcast(session.id, {
                type: 'error',
                message: 'At most 3 agents can participate in a single mention conversation.',
                source: 'system',
                sourceLabel: getSourceLabel('system'),
            });
            return;
        }
        const toolId = mentions[0].toolId;
        if (mentions.some(mention => mention.toolId !== toolId)) {
            this.broadcast(session.id, {
                type: 'error',
                message: 'All mentioned agents must belong to the same CLI tool.',
                source: 'system',
                sourceLabel: getSourceLabel('system'),
            });
            return;
        }
        const tools = getVibeTools();
        const tool = tools.find(item => item.id === toolId);
        if (!tool?.supportsExecution) {
            this.broadcast(session.id, {
                type: 'error',
                message: tool?.detail || 'The selected CLI tool is not currently available.',
                source: 'system',
                sourceLabel: getSourceLabel('system'),
            });
            return;
        }
        const leadAgent = this.resolveMentionAgent(tool, mentions[0]);
        if (!leadAgent) {
            this.broadcast(session.id, {
                type: 'error',
                message: `Unable to resolve agent ${mentions[0].name}.`,
                source: 'system',
                sourceLabel: getSourceLabel('system'),
            });
            return;
        }
        const collaboratorAgents = mentions
            .slice(1)
            .map(mention => this.resolveMentionAgent(tool, mention))
            .filter((agent) => !!agent);
        if (collaboratorAgents.length !== Math.max(mentions.length - 1, 0)) {
            this.broadcast(session.id, {
                type: 'error',
                message: 'One or more mentioned agents could not be resolved for the current CLI.',
                source: 'system',
                sourceLabel: getSourceLabel('system'),
            });
            return;
        }
        this.clearStreamingMessage(session.id);
        touchSession(session.id);
        const userMessage = saveMessage(session.id, 'user', text);
        const renamedSession = updateSessionNameFromFirstMessage(session.id, text);
        if (renamedSession) {
            this.broadcast(session.id, { type: 'session_updated', session: renamedSession });
        }
        this.broadcast(session.id, { type: 'user', content: text, messageId: userMessage.id });
        const manager = this.getManager(session.id);
        if (manager.isRunning()) {
            await manager.stop();
        }
        if (!collaboratorAgents.length) {
            await manager.start(session.projectDir, text, tool.id, {
                requestedAgentName: leadAgent.name,
                requestedAgentLabel: leadAgent.name,
                preamble: this.buildLeadAgentPreamble(tool, leadAgent),
            });
            return;
        }
        const collaboratorReplies = [];
        for (const collaborator of collaboratorAgents) {
            const leadQuestion = `@${collaborator.name} 用户想知道你现在在做什么，请直接告诉我你当前在处理的事情。`;
            this.broadcastAgentMessage(session.id, tool.id, leadAgent, leadQuestion, collaborator.name);
            const collaboratorResult = await manager.start(session.projectDir, text, tool.id, {
                requestedAgentName: collaborator.name,
                requestedAgentLabel: collaborator.name,
                preamble: this.buildCollaboratorPreamble(tool, leadAgent, collaborator, text),
            });
            const collaboratorReply = collaboratorResult.assistantText?.trim() || `${collaborator.name} did not provide a usable reply.`;
            collaboratorReplies.push({ agent: collaborator, reply: collaboratorReply });
        }
        await manager.start(session.projectDir, text, tool.id, {
            requestedAgentName: leadAgent.name,
            requestedAgentLabel: leadAgent.name,
            preamble: this.buildLeadSummaryPreamble(tool, leadAgent, text, collaboratorReplies),
        });
    }
    resolveMentionAgent(tool, mention) {
        return tool.agents.find(agent => agent.id === mention.agentId || agent.name === mention.name) || null;
    }
    buildLeadAgentPreamble(tool, leadAgent) {
        const capabilities = leadAgent.capabilities.slice(0, 4).join('；');
        return [
            `你现在在 ${tool.label} CLI 中扮演 Agent "${leadAgent.name}"。`,
            leadAgent.description ? `你的职责：${leadAgent.description}` : '',
            capabilities ? `你的能力重点：${capabilities}` : '',
            '请直接面向最终用户回答。',
            '如果没有被明确要求，不要主动再 @ 其他 agent。',
        ].filter(Boolean).join('\n');
    }
    buildCollaboratorPreamble(tool, leadAgent, collaborator, userText) {
        const capabilities = collaborator.capabilities.slice(0, 4).join('；');
        return [
            `你现在在 ${tool.label} CLI 中扮演 Agent "${collaborator.name}"。`,
            collaborator.description ? `你的职责：${collaborator.description}` : '',
            capabilities ? `你的能力重点：${capabilities}` : '',
            `主 Agent 是 "${leadAgent.name}"。`,
            `最终用户的原始问题是：${userText}`,
            `请直接回复给 ${leadAgent.name}，说明你当前在做什么，或者你当前掌握了什么进展。`,
            '不要直接面向最终用户，不要再 @ 其他 agent，尽量控制在 3 句以内。',
        ].filter(Boolean).join('\n');
    }
    buildLeadSummaryPreamble(tool, leadAgent, userText, collaboratorReplies) {
        const summaries = collaboratorReplies
            .map(item => `- ${item.agent.name}：${item.reply}`)
            .join('\n');
        return [
            `你现在在 ${tool.label} CLI 中扮演 Agent "${leadAgent.name}"。`,
            leadAgent.description ? `你的职责：${leadAgent.description}` : '',
            `最终用户的原始问题是：${userText}`,
            '你刚刚从其他 agent 那里获得了这些公开回复：',
            summaries || '- 暂无有效回复',
            '请直接面向最终用户，用自然语言说明其他 agent 当前在做什么。',
            '不要再发起新的 @agent 提问。',
        ].filter(Boolean).join('\n');
    }
    broadcastAgentMessage(sessionId, tool, agent, content, targetAgentName) {
        const sourceLabel = targetAgentName
            ? `${getSourceLabel(tool)} / ${agent.name} -> ${targetAgentName}`
            : `${getSourceLabel(tool)} / ${agent.name}`;
        const messageId = crypto.randomUUID();
        saveMessage(sessionId, 'text', content, {
            source: tool,
            sourceLabel,
            sourceAgent: agent.id,
            sourceAgentLabel: agent.name,
            targetAgentName,
        });
        this.broadcast(sessionId, {
            type: 'text',
            content,
            messageId,
            source: tool,
            sourceLabel,
            sourceAgent: agent.id,
            sourceAgentLabel: agent.name,
        });
    }
    async executeWithFallback(sessionId, projectDir, text, preferredTool, tools = getVibeTools()) {
        const manager = this.getManager(sessionId);
        const conversationState = getConversationState(sessionId);
        const toolSessionMap = getToolSessionMap(sessionId);
        const recentMessages = getRecentMessagesWindow(sessionId, 8).messages;
        const fallbackTools = getFallbackTools(text, preferredTool, tools);
        const toolQueue = [preferredTool, ...fallbackTools];
        let previousFailure = null;
        // 失败回退按“首选工具 -> 备选工具队列”顺序尝试。
        // 一旦某个工具已经产出可展示内容，就认为本轮执行接管成功，不再继续切换。
        for (let index = 0; index < toolQueue.length; index += 1) {
            const tool = toolQueue[index];
            if (index > 0 && previousFailure) {
                const switchNotice = this.buildFallbackNotice(previousFailure.tool, tool, previousFailure.failureKind);
                this.broadcastModeChanged(sessionId, tool, switchNotice);
                this.broadcastSystemText(sessionId, switchNotice);
            }
            const executionInput = buildExecutionInput({
                text,
                targetTool: tool,
                toolHasNativeSession: !!toolSessionMap[tool],
                lastSuccessfulTool: conversationState.lastSuccessfulTool,
                handoffFromTool: index > 0 ? previousFailure?.tool : null,
                conversationState,
                recentMessages,
            });
            const result = await manager.start(projectDir, executionInput, tool);
            if (result.ok || result.producedOutput) {
                this.persistManagerSessionState(sessionId, manager, result.ok ? tool : undefined);
                return result;
            }
            previousFailure = {
                tool,
                failureKind: result.failureKind,
                errorMessage: result.errorMessage,
            };
            if (!result.recoverable) {
                break;
            }
        }
        if (previousFailure) {
            this.broadcast(sessionId, {
                type: 'error',
                message: this.buildFinalFailureMessage(previousFailure.tool, previousFailure.failureKind, previousFailure.errorMessage),
                source: 'system',
                sourceLabel: getSourceLabel('system'),
            });
        }
        return null;
    }
    async handleCCMessage(sessionId, msg) {
        const session = getSession(sessionId);
        if (!session)
            return;
        const manager = this.managers.get(sessionId);
        const source = this.getManagerSource(manager);
        const sourceMetadata = this.getSourceMetadata(source, manager);
        this.persistManagerSessionState(sessionId, manager, source);
        // 这一层负责把各家 CLI 的输出统一持久化到消息表，再广播给同房间所有设备。
        // 尤其 text/thinking 是流式消息，需要特殊处理 messageId 复用和增量追加。
        if (msg.type === 'status') {
            if (msg.state === 'idle' || msg.state === 'executing' || msg.state === 'waiting_confirm') {
                this.clearStreamingMessage(session.id);
            }
            if (msg.state === 'idle') {
                refreshConversationStateFromRecentHistory(session.id);
            }
            this.broadcast(sessionId, msg);
            return;
        }
        if (msg.type === 'text' || msg.type === 'thinking') {
            const messageId = this.persistStreamingMessage(session.id, msg.type, msg.content, sourceMetadata);
            this.broadcast(sessionId, { ...msg, messageId, ...sourceMetadata });
            return;
        }
        if (msg.type === 'thinking_done') {
            this.clearStreamingMessage(session.id, 'thinking');
            this.broadcast(sessionId, { ...msg, ...sourceMetadata });
            return;
        }
        if (msg.type !== 'pong') {
            this.clearStreamingMessage(session.id);
            let content = '';
            let metadata = {};
            switch (msg.type) {
                case 'error':
                    content = msg.message;
                    metadata = sourceMetadata;
                    break;
                case 'code':
                    content = msg.content;
                    metadata = { ...sourceMetadata, language: msg.lang };
                    break;
                case 'diff':
                    content = msg.content;
                    metadata = sourceMetadata;
                    break;
                case 'tool_use':
                    metadata = { ...sourceMetadata, toolName: msg.toolName, toolInput: msg.toolInput };
                    break;
                case 'tool_result':
                    content = msg.content;
                    metadata = { ...sourceMetadata, parentId: msg.parentId };
                    break;
            }
            if (content || Object.keys(metadata).length > 0) {
                saveMessage(session.id, msg.type, content, metadata);
            }
        }
        this.broadcast(sessionId, this.attachSource(msg, sourceMetadata));
    }
    persistStreamingMessage(sessionId, type, content, metadata) {
        const current = this.streamingMessages.get(sessionId);
        if (current?.type === type) {
            appendMessageContent(current.messageId, content);
            return current.messageId;
        }
        this.clearStreamingMessage(sessionId);
        const messageId = crypto.randomUUID();
        saveMessage(sessionId, type, content, metadata, messageId);
        this.streamingMessages.set(sessionId, { type, messageId });
        return messageId;
    }
    getManagerSource(manager) {
        const tool = manager?.getTool();
        return tool === 'claude' || tool === 'codex' || tool === 'opencode' ? tool : undefined;
    }
    getSourceMetadata(source, manager) {
        if (!source)
            return {};
        const sourceAgent = manager?.getAgentName() || undefined;
        const sourceAgentLabel = manager?.getAgentLabel() || undefined;
        const sourceLabel = sourceAgentLabel
            ? `${getSourceLabel(source)} / ${sourceAgentLabel}`
            : getSourceLabel(source);
        return {
            source,
            sourceLabel,
            sourceAgent,
            sourceAgentLabel,
        };
    }
    attachSource(msg, sourceMetadata) {
        if (!sourceMetadata.source)
            return msg;
        switch (msg.type) {
            case 'text':
            case 'thinking':
            case 'thinking_done':
            case 'code':
            case 'diff':
            case 'tool_use':
            case 'tool_result':
            case 'error':
                return { ...msg, ...sourceMetadata };
            default:
                return msg;
        }
    }
    clearStreamingMessage(sessionId, type) {
        const current = this.streamingMessages.get(sessionId);
        if (!current)
            return;
        if (type && current.type !== type)
            return;
        this.streamingMessages.delete(sessionId);
    }
    persistManagerSessionState(sessionId, manager, successfulTool) {
        if (!manager)
            return;
        const tool = manager.getTool();
        const nativeSessionId = manager.getSessionId();
        if (tool && nativeSessionId) {
            setToolSessionId(sessionId, tool, nativeSessionId, manager.getStatus());
        }
        if (successfulTool) {
            upsertConversationState(sessionId, { lastSuccessfulTool: successfulTool });
        }
    }
    sendSessionState(client, sessionId) {
        const session = getSession(sessionId);
        if (!session) {
            this.sendToClient(client, { type: 'error', message: 'Session not found' });
            return;
        }
        const page = getRecentMessagesWindow(session.id);
        this.sendToClient(client, {
            type: 'session_state',
            messages: page.messages,
            hasMore: page.hasMore,
            oldestSeq: page.oldestSeq,
            session,
        });
        const activeMode = this.sessionModes.get(sessionId);
        if (activeMode) {
            this.sendToClient(client, { type: 'mode_changed', mode: activeMode });
        }
    }
    setSessionMode(sessionId, mode, reason) {
        this.sessionModes.set(sessionId, mode);
        this.broadcastModeChanged(sessionId, mode, reason);
    }
    sendToClient(client, msg) {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(serializeServerMsg(msg));
        }
    }
    broadcast(sessionId, msg) {
        const data = serializeServerMsg(msg);
        for (const client of this.clients) {
            if (client.authenticated && client.sessionId === sessionId && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(data);
            }
        }
    }
    broadcastModeChanged(sessionId, mode, reason) {
        this.broadcast(sessionId, { type: 'mode_changed', mode, reason });
    }
    broadcastSystemText(sessionId, content) {
        saveMessage(sessionId, 'text', content, {
            source: 'system',
            sourceLabel: getSourceLabel('system'),
        });
        this.broadcast(sessionId, {
            type: 'text',
            content,
            messageId: crypto.randomUUID(),
            source: 'system',
            sourceLabel: getSourceLabel('system'),
        });
    }
    buildFallbackNotice(from, to, failureKind) {
        const fromLabel = getSourceLabel(from);
        const toLabel = getSourceLabel(to);
        const reason = this.describeFailureKind(failureKind);
        return reason
            ? `${fromLabel} 当前不可用，已自动切换到 ${toLabel}（${reason}）。`
            : `${fromLabel} 当前不可用，已自动切换到 ${toLabel}。`;
    }
    buildFinalFailureMessage(tool, failureKind, errorMessage) {
        const label = getSourceLabel(tool);
        const reason = this.describeFailureKind(failureKind);
        if (reason) {
            return `${label} 当前不可用（${reason}），并且没有可自动切换的其他工具。`;
        }
        if (errorMessage) {
            return `${label} 当前不可用，并且没有可自动切换的其他工具：${errorMessage}`;
        }
        return `${label} 当前不可用，并且没有可自动切换的其他工具。`;
    }
    describeFailureKind(failureKind) {
        switch (failureKind) {
            case 'auth':
                return '认证失败';
            case 'network':
                return '网络异常';
            case 'model':
                return '模型或 provider 不可用';
            case 'unavailable':
                return 'CLI 不可用';
            default:
                return undefined;
        }
    }
}
//# sourceMappingURL=gateway.js.map