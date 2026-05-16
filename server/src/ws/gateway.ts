import { WebSocketServer, WebSocket } from 'ws'
import type { Server as HttpServer } from 'node:http'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { getConfig } from '../config.js'
import {
  getConversationState,
  getSession,
  getToolSessionMap,
  setToolSessionId,
  touchSession,
  updateSessionNameFromFirstMessage,
  upsertConversationState,
} from '../store/sessions.js'
import { refreshConversationStateFromRecentHistory } from '../store/conversation.js'
import { appendMessageContent, getRecentMessagesWindow, saveMessage } from '../store/messages.js'
import { CCManager } from '../cc/manager.js'
import { buildExecutionInput } from '../cc/context.js'
import { runMentionConversation, validateMentionConversationRequest } from '../agents/orchestrator.js'
import { parseClientMessage, serializeServerMsg } from './protocol.js'
import { logger } from '../utils/logger.js'
import { getFallbackTools, getVibeTools, planToolRoute } from '../tools/vibe.js'
import { getSlashHelpText, parseSlashCommand } from '../commands/slash.js'
import type { AgentMention, MessageSource, ServerMsg, MessageType, ToolExecutionMode, ToolFailureKind, VibeToolId } from '../types/index.js'

interface ClientState {
  ws: WebSocket
  authenticated: boolean
  alive: boolean
  sessionId: string | null
}

interface StreamingMessageState {
  type: 'text' | 'thinking'
  messageId: string
}

// WebSocket 层给前端的 source label 做最后一次兜底，
// 避免前端还要知道每个 tool id 应该显示成什么名字。
function getSourceLabel(source: MessageSource | undefined) {
  switch (source) {
    case 'claude':
      return 'Claude'
    case 'codex':
      return 'Codex'
    case 'opencode':
      return 'OpenCode'
    default:
      return '系统'
  }
}

export class WSGateway {
  // 一个 session 对应一个 CCManager；
  // clients 是所有已连接设备，managers 是每个会话背后真正跑 CLI 的执行器。
  private wss!: WebSocketServer
  private clients = new Set<ClientState>()
  private managers = new Map<string, CCManager>()
  private sessionModes = new Map<string, ToolExecutionMode>()
  private streamingMessages = new Map<string, StreamingMessageState>()

  init(httpServer: HttpServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' })

    this.wss.on('connection', (ws) => {
      const client: ClientState = { ws, authenticated: false, alive: true, sessionId: null }
      this.clients.add(client)

      ws.on('message', (raw) => {
        try {
          this.handleMessage(client, raw.toString())
        } catch (err) {
          logger.error('WS message error:', err)
        }
      })

      ws.on('close', () => {
        this.clients.delete(client)
      })

      ws.on('pong', () => {
        client.alive = true
      })
    })

    // 标准心跳：客户端每 30s 必须回应 pong，否则视为死连接。
    const interval = setInterval(() => {
      for (const client of this.clients) {
        if (!client.alive) {
          client.ws.terminate()
          this.clients.delete(client)
          continue
        }
        client.alive = false
        client.ws.ping()
      }
    }, 30000)

    this.wss.on('close', () => clearInterval(interval))
    logger.info('WebSocket gateway initialized')
  }

  private handleMessage(client: ClientState, rawData: string) {
    const msg = parseClientMessage(rawData)
    if (!msg) return

    // 这里严格按消息类型分流：
    // auth 只改连接态，join_session 只同步历史，input/confirm/cancel 才会触发真正执行。
    switch (msg.type) {
      case 'auth':
        try {
          jwt.verify(msg.token, getConfig().jwtSecret)
          client.authenticated = true
          this.sendToClient(client, { type: 'auth_ok', session: {} as any })
        } catch {
          this.sendToClient(client, { type: 'auth_error', message: 'Invalid token' })
        }
        break

      case 'join_session':
        if (!client.authenticated) return
        client.sessionId = msg.sessionId
        this.sendSessionState(client, msg.sessionId)
        break

      case 'set_mode':
        if (!client.authenticated) return
        this.setSessionMode(msg.sessionId, msg.mode)
        break

      case 'input':
        if (!client.authenticated) return
        this.handleInput(msg.sessionId, msg.text, msg.mode, msg.mentions || [])
        break

      case 'confirm':
        if (!client.authenticated || !msg.sessionId) return
        this.getManager(msg.sessionId)?.sendConfirm(msg.requestId, msg.allow)
        break

      case 'cancel':
        if (!client.authenticated || !msg.sessionId) return
        this.getManager(msg.sessionId)?.cancel()
        break

      case 'ping':
        this.sendToClient(client, { type: 'pong' })
        break
    }
  }

  private getManager(sessionId: string): CCManager {
    let manager = this.managers.get(sessionId)
    if (manager) return manager

    // manager 按 session 懒创建，避免还没进入某个会话时就提前占进程资源。
    manager = new CCManager()
    manager.setBroadcast((msg) => this.handleCCMessage(sessionId, msg))
    manager.hydrateToolSessions(getToolSessionMap(sessionId))
    this.managers.set(sessionId, manager)
    return manager
  }

  private async handleInput(sessionId: string, text: string, mode?: ToolExecutionMode, mentions: AgentMention[] = []) {
    const session = getSession(sessionId)
    if (!session) return

    if (mode) {
      this.setSessionMode(session.id, mode)
    }

    // slash 命令优先级高于普通自然语言输入，
    // 因为它表达的是“明确要切工具/跑命令/展示帮助”的控制意图。
    const slash = parseSlashCommand(text)
    if (slash) {
      if (slash.kind === 'help') {
        const helpText = getSlashHelpText()
        saveMessage(session.id, 'text', helpText, { source: 'system', sourceLabel: getSourceLabel('system') })
        this.broadcast(session.id, {
          type: 'text',
          content: helpText,
          messageId: crypto.randomUUID(),
          source: 'system',
          sourceLabel: getSourceLabel('system'),
        })
        return
      }

      if (slash.kind === 'error') {
        this.broadcast(session.id, {
          type: 'error',
          message: slash.message,
          source: 'system',
          sourceLabel: getSourceLabel('system'),
        })
        return
      }

      if (slash.kind === 'tool-command') {
        this.clearStreamingMessage(session.id)
        touchSession(session.id)
        this.persistAndBroadcastUserMessage(session.id, text)

        const manager = this.getManager(session.id)
        if (manager.isRunning()) {
          await manager.stop()
        }

        await manager.startCommand(session.projectDir, slash.tool, slash.args)
        return
      }

      text = slash.prompt
      mode = slash.mode || mode
    }

    upsertConversationState(session.id, { currentGoal: text })
    const orderedMentions = mentions
      .slice()
      .sort((left, right) => left.order - right.order)
      .filter((mention, index, array) => array.findIndex(item => item.agentId === mention.agentId) === index)
    if (orderedMentions.length) {
      const mentionValidation = validateMentionConversationRequest({
        mentions: orderedMentions,
        tools: getVibeTools(),
        requireExecutable: true,
      })
      if (!mentionValidation.ok) {
        this.broadcast(session.id, {
          type: 'error',
          message: mentionValidation.errorMessage,
          source: 'system',
          sourceLabel: getSourceLabel('system'),
        })
        return
      }

      this.clearStreamingMessage(session.id)
      touchSession(session.id)

      const manager = this.getManager(session.id)
      if (manager.isRunning()) {
        await manager.stop()
      }

      const result = await runMentionConversation({
        sessionId: session.id,
        projectDir: session.projectDir,
        text,
        mentions: orderedMentions,
        tool: mentionValidation.tool,
        manager,
        onUserMessage: (message) => {
          this.persistAndBroadcastUserMessage(session.id, message.content, {
            senderType: message.senderType,
            orchestrationStep: message.orchestrationStep,
          })
        },
        savePublicMessage: (message) => {
          this.savePublicTextMessage(session.id, message)
        },
        publish: (message) => {
          this.broadcast(session.id, message)
        },
      })

      if (!result.ok) {
        this.broadcast(session.id, {
          type: 'error',
          message: result.errorMessage || 'The mention conversation could not be completed.',
          source: 'system',
          sourceLabel: getSourceLabel('system'),
        })
      }
      return
    }
    // 普通输入先经过工具路由器，决定这一轮由 Claude / Codex / OpenCode 谁来处理。
    const conversationState = getConversationState(session.id)
    const toolSessionMap = getToolSessionMap(session.id)
    const routePlan = planToolRoute(text, mode, getVibeTools(), {
      lastSuccessfulTool: conversationState.lastSuccessfulTool,
      availableSessionTools: Object.keys(toolSessionMap) as VibeToolId[],
    })
    if (!routePlan.selectedTools.length || routePlan.blockedReason) {
      this.broadcast(sessionId, {
        type: 'error',
        message: routePlan.blockedReason || routePlan.summary,
        source: 'system',
        sourceLabel: getSourceLabel('system'),
      })
      return
    }

    if (routePlan.mode === 'parallel') {
      this.broadcast(sessionId, {
        type: 'error',
        message: '并行执行还没有接入完成，请先选择单个工具。',
        source: 'system',
        sourceLabel: getSourceLabel('system'),
      })
      return
    }

    this.clearStreamingMessage(session.id)
    touchSession(session.id)
    this.persistAndBroadcastUserMessage(session.id, text)

    const manager = this.getManager(session.id)
    if (manager.isRunning()) {
      // 当前设计是一条 session 同时只跑一个 CLI 任务，
      // 新请求来了就先停掉旧任务，避免多路输出互相污染。
      await manager.stop()
    }

    const tools = getVibeTools()
    await this.executeWithFallback(session.id, session.projectDir, text, routePlan.selectedTools[0], tools)
  }

  private async executeWithFallback(
    sessionId: string,
    projectDir: string,
    text: string,
    preferredTool: VibeToolId,
    tools = getVibeTools(),
  ) {
    const manager = this.getManager(sessionId)
    const conversationState = getConversationState(sessionId)
    const toolSessionMap = getToolSessionMap(sessionId)
    const recentMessages = getRecentMessagesWindow(sessionId, 8).messages
    const fallbackTools = getFallbackTools(text, preferredTool, tools)
    const toolQueue: VibeToolId[] = [preferredTool, ...fallbackTools]
    let previousFailure: {
      tool: VibeToolId
      failureKind?: ToolFailureKind
      errorMessage?: string
    } | null = null

    // 失败回退按“首选工具 -> 备选工具队列”顺序尝试。
    // 一旦某个工具已经产出可展示内容，就认为本轮执行接管成功，不再继续切换。
    for (let index = 0; index < toolQueue.length; index += 1) {
      const tool = toolQueue[index]

      if (index > 0 && previousFailure) {
        const switchNotice = this.buildFallbackNotice(previousFailure.tool, tool, previousFailure.failureKind)
        this.broadcastModeChanged(sessionId, tool, switchNotice)
        this.broadcastSystemText(sessionId, switchNotice)
      }

      const executionInput = buildExecutionInput({
        text,
        targetTool: tool,
        toolHasNativeSession: !!toolSessionMap[tool],
        lastSuccessfulTool: conversationState.lastSuccessfulTool,
        handoffFromTool: index > 0 ? previousFailure?.tool : null,
        conversationState,
        recentMessages,
      })

      const result = await manager.start(projectDir, executionInput, tool)
      if (result.ok || result.producedOutput) {
        this.persistManagerSessionState(sessionId, manager, result.ok ? tool : undefined)
        return result
      }

      previousFailure = {
        tool,
        failureKind: result.failureKind,
        errorMessage: result.errorMessage,
      }

      if (!result.recoverable) {
        break
      }
    }

    if (previousFailure) {
      this.broadcast(sessionId, {
        type: 'error',
        message: this.buildFinalFailureMessage(previousFailure.tool, previousFailure.failureKind, previousFailure.errorMessage),
        source: 'system',
        sourceLabel: getSourceLabel('system'),
      })
    }

    return null
  }

  private async handleCCMessage(sessionId: string, msg: ServerMsg) {
    const session = getSession(sessionId)
    if (!session) return

    const manager = this.managers.get(sessionId)
    const source = this.getManagerSource(manager)
    const sourceMetadata = this.getSourceMetadata(source, manager)

    this.persistManagerSessionState(sessionId, manager, source)

    // 这一层负责把各家 CLI 的输出统一持久化到消息表，再广播给同房间所有设备。
    // 尤其 text/thinking 是流式消息，需要特殊处理 messageId 复用和增量追加。
    if (msg.type === 'status') {
      if (msg.state === 'idle' || msg.state === 'executing' || msg.state === 'waiting_confirm') {
        this.clearStreamingMessage(session.id)
      }
      if (msg.state === 'idle') {
        refreshConversationStateFromRecentHistory(session.id)
      }
      this.broadcast(sessionId, msg)
      return
    }

    if (msg.type === 'text' || msg.type === 'thinking') {
      const messageId = this.persistStreamingMessage(session.id, msg.type, msg.content, sourceMetadata)
      this.broadcast(sessionId, { ...msg, messageId, ...sourceMetadata })
      return
    }

    if (msg.type === 'thinking_done') {
      this.clearStreamingMessage(session.id, 'thinking')
      this.broadcast(sessionId, { ...msg, ...sourceMetadata })
      return
    }

    if (msg.type !== 'pong') {
      this.clearStreamingMessage(session.id)
      let content = ''
      let metadata: Record<string, unknown> = {}

      switch (msg.type) {
        case 'error':
          content = msg.message
          metadata = sourceMetadata
          break
        case 'code':
          content = msg.content
          metadata = { ...sourceMetadata, language: msg.lang }
          break
        case 'diff':
          content = msg.content
          metadata = sourceMetadata
          break
        case 'tool_use':
          metadata = { ...sourceMetadata, toolName: msg.toolName, toolInput: msg.toolInput }
          break
        case 'tool_result':
          content = msg.content
          metadata = { ...sourceMetadata, parentId: msg.parentId }
          break
      }

      if (content || Object.keys(metadata).length > 0) {
        saveMessage(session.id, msg.type as MessageType, content, metadata)
      }
    }

    this.broadcast(sessionId, this.attachSource(msg, sourceMetadata))
  }

  private persistStreamingMessage(
    sessionId: string,
    type: 'text' | 'thinking',
    content: string,
    metadata: Record<string, unknown>,
  ) {
    const current = this.streamingMessages.get(sessionId)
    if (current?.type === type) {
      appendMessageContent(current.messageId, content)
      return current.messageId
    }

    this.clearStreamingMessage(sessionId)

    const messageId = crypto.randomUUID()
    saveMessage(sessionId, type, content, metadata, messageId)
    this.streamingMessages.set(sessionId, { type, messageId })
    return messageId
  }

  private getManagerSource(manager: CCManager | undefined): VibeToolId | undefined {
    const tool = manager?.getTool()
    return tool === 'claude' || tool === 'codex' || tool === 'opencode' ? tool : undefined
  }

  private getSourceMetadata(source: VibeToolId | undefined, manager?: CCManager) {
    if (!source) return {}

    const sourceAgent = manager?.getAgentName() || undefined
    const sourceAgentLabel = manager?.getAgentLabel() || undefined
    const sourceLabel = sourceAgentLabel
      ? `${getSourceLabel(source)} / ${sourceAgentLabel}`
      : getSourceLabel(source)

    return {
      source,
      sourceLabel,
      sourceAgent,
      sourceAgentLabel,
    }
  }

  private attachSource(msg: ServerMsg, sourceMetadata: Record<string, unknown>): ServerMsg {
    if (!sourceMetadata.source) return msg

    switch (msg.type) {
      case 'text':
      case 'thinking':
      case 'thinking_done':
      case 'code':
      case 'diff':
      case 'tool_use':
      case 'tool_result':
      case 'error':
        return { ...msg, ...sourceMetadata }
      default:
        return msg
    }
  }

  private clearStreamingMessage(sessionId: string, type?: 'text' | 'thinking') {
    const current = this.streamingMessages.get(sessionId)
    if (!current) return
    if (type && current.type !== type) return
    this.streamingMessages.delete(sessionId)
  }

  private persistAndBroadcastUserMessage(
    sessionId: string,
    content: string,
    metadata: Pick<Extract<ServerMsg, { type: 'user' }>, 'senderType' | 'orchestrationStep'> = {},
  ) {
    const userMessage = saveMessage(sessionId, 'user', content, metadata)
    const renamedSession = updateSessionNameFromFirstMessage(sessionId, content)
    if (renamedSession) {
      this.broadcast(sessionId, { type: 'session_updated', session: renamedSession })
    }
    this.broadcast(sessionId, {
      type: 'user',
      content,
      messageId: userMessage.id,
      ...metadata,
    })
    return userMessage
  }

  private savePublicTextMessage(sessionId: string, message: Extract<ServerMsg, { type: 'text' }>) {
    const { type: _type, content, messageId, ...metadata } = message
    saveMessage(sessionId, 'text', content, metadata, messageId)
  }

  private persistManagerSessionState(
    sessionId: string,
    manager: CCManager | undefined,
    successfulTool?: VibeToolId,
  ) {
    if (!manager) return

    const tool = manager.getTool()
    const nativeSessionId = manager.getSessionId()
    if (tool && nativeSessionId) {
      setToolSessionId(sessionId, tool, nativeSessionId, manager.getStatus())
    }

    if (successfulTool) {
      upsertConversationState(sessionId, { lastSuccessfulTool: successfulTool })
    }
  }

  private sendSessionState(client: ClientState, sessionId: string) {
    const session = getSession(sessionId)
    if (!session) {
      this.sendToClient(client, { type: 'error', message: 'Session not found' })
      return
    }
    const page = getRecentMessagesWindow(session.id)
    this.sendToClient(client, {
      type: 'session_state',
      messages: page.messages,
      hasMore: page.hasMore,
      oldestSeq: page.oldestSeq,
      session,
    })

    const activeMode = this.sessionModes.get(sessionId)
    if (activeMode) {
      this.sendToClient(client, { type: 'mode_changed', mode: activeMode })
    }
  }

  private setSessionMode(sessionId: string, mode: ToolExecutionMode, reason?: string) {
    this.sessionModes.set(sessionId, mode)
    this.broadcastModeChanged(sessionId, mode, reason)
  }

  private sendToClient(client: ClientState, msg: ServerMsg) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(serializeServerMsg(msg))
    }
  }

  private broadcast(sessionId: string, msg: ServerMsg) {
    const data = serializeServerMsg(msg)
    for (const client of this.clients) {
      if (client.authenticated && client.sessionId === sessionId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data)
      }
    }
  }

  private broadcastModeChanged(sessionId: string, mode: ToolExecutionMode, reason?: string) {
    this.broadcast(sessionId, { type: 'mode_changed', mode, reason })
  }

  private broadcastSystemText(sessionId: string, content: string) {
    saveMessage(sessionId, 'text', content, {
      source: 'system',
      sourceLabel: getSourceLabel('system'),
    })
    this.broadcast(sessionId, {
      type: 'text',
      content,
      messageId: crypto.randomUUID(),
      source: 'system',
      sourceLabel: getSourceLabel('system'),
    })
  }

  private buildFallbackNotice(from: VibeToolId, to: VibeToolId, failureKind?: ToolFailureKind) {
    const fromLabel = getSourceLabel(from)
    const toLabel = getSourceLabel(to)
    const reason = this.describeFailureKind(failureKind)
    return reason
      ? `${fromLabel} 当前不可用，已自动切换到 ${toLabel}（${reason}）。`
      : `${fromLabel} 当前不可用，已自动切换到 ${toLabel}。`
  }

  private buildFinalFailureMessage(tool: VibeToolId, failureKind?: ToolFailureKind, errorMessage?: string) {
    const label = getSourceLabel(tool)
    const reason = this.describeFailureKind(failureKind)
    if (reason) {
      return `${label} 当前不可用（${reason}），并且没有可自动切换的其他工具。`
    }
    if (errorMessage) {
      return `${label} 当前不可用，并且没有可自动切换的其他工具：${errorMessage}`
    }
    return `${label} 当前不可用，并且没有可自动切换的其他工具。`
  }

  private describeFailureKind(failureKind?: ToolFailureKind) {
    switch (failureKind) {
      case 'auth':
        return '认证失败'
      case 'network':
        return '网络异常'
      case 'model':
        return '模型或 provider 不可用'
      case 'unavailable':
        return 'CLI 不可用'
      default:
        return undefined
    }
  }
}
