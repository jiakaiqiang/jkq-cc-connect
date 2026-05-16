import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AgentMention, Message, MessageSource, SessionInfo, ServerMsg, CCStatus, ToolExecutionMode } from '@/types'
import { useWSStore } from './ws'
import { generateId } from '@/utils/uuid'

export interface UIMessage {
  id: string
  type: string
  content: string
  metadata: Record<string, unknown>
  timestamp: string
  streaming?: boolean
}

export interface ActiveToolUseState {
  toolName: string
  toolInput: Record<string, unknown>
  sourceLabel?: string
}

type MessageMutationKind = 'append' | 'prepend' | 'reset'

// 这个文件承担两层职责：
// 1. 把服务端历史消息 Message 规范化成适合渲染的 UIMessage。
// 2. 把流式到达的 text/thinking 片段按 source、messageId 合并，避免页面闪烁出一堆碎消息。
//
// 下面这大段 helper 看起来很多，实际都围绕“流式消息边界管理”这一件事服务：
// 当 assistant 正在连续输出时尽量合并；一旦用户消息、工具卡片、错误消息等边界事件出现，就及时截断。
function sourceLabelFrom(source: MessageSource | undefined) {
  switch (source) {
    case 'claude': return 'Claude'
    case 'codex': return 'Codex'
    case 'opencode': return 'OpenCode'
    case 'system': return '系统'
    default: return undefined
  }
}

function withSourceMetadata(metadata: Record<string, unknown>, source: MessageSource | undefined) {
  if (!source) return metadata
  return { ...metadata, source, sourceLabel: sourceLabelFrom(source) }
}

function withIncomingSourceMetadata(
  metadata: Record<string, unknown>,
  source: MessageSource | undefined,
  sourceLabel?: string,
  sourceAgent?: string,
  sourceAgentLabel?: string,
) {
  const result = source ? withSourceMetadata(metadata, source) : { ...metadata }
  if (sourceLabel) result.sourceLabel = sourceLabel
  if (sourceAgent) result.sourceAgent = sourceAgent
  if (sourceAgentLabel) result.sourceAgentLabel = sourceAgentLabel
  return result
}

function isAssistantRenderable(type: string) {
  return type === 'text' || type === 'thinking'
}

function isUserVisibleTerminal(type: string) {
  return type === 'tool_use' || type === 'code' || type === 'diff' || type === 'confirm_request' || type === 'error'
}

function isUserText(type: string) {
  return type === 'user'
}

function isStreamingTextMessage(message: UIMessage | undefined) {
  return !!message && message.type === 'text' && message.streaming
}

function isStreamingThinkingMessage(message: UIMessage | undefined) {
  return !!message && message.type === 'thinking' && message.streaming
}

function finalizeStreamingMessages(messages: UIMessage[]) {
  for (const message of messages) {
    if (message.streaming && isAssistantRenderable(message.type)) {
      message.streaming = false
    }
  }
}

function lastMessage(messages: UIMessage[]) {
  return messages[messages.length - 1]
}

function findMessageById(messages: UIMessage[], id: string) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].id === id) return messages[index]
  }
  return undefined
}

function canAppendToStreamingText(message: UIMessage | undefined) {
  return isStreamingTextMessage(message)
}

function canAppendToStreamingThinking(message: UIMessage | undefined) {
  return isStreamingThinkingMessage(message)
}

function breakStreamingIfNeeded(messages: UIMessage[]) {
  const message = lastMessage(messages)
  if (message?.streaming) {
    message.streaming = false
  }
}

function appendToExistingMessage(message: UIMessage | undefined, chunk: string) {
  if (!message) return false
  message.content += chunk
  message.timestamp = new Date().toISOString()
  message.streaming = true
  return true
}

function mergeMetadata(target: UIMessage, metadata: Record<string, unknown>) {
  target.metadata = { ...target.metadata, ...metadata }
}

function sameSource(left: Record<string, unknown>, right: Record<string, unknown>) {
  return (
    (left.source as MessageSource | undefined) === (right.source as MessageSource | undefined) &&
    (left.sourceAgent as string | undefined) === (right.sourceAgent as string | undefined)
  )
}

function appendStreamingText(messages: UIMessage[], chunk: string, id: string, metadata: Record<string, unknown> = {}) {
  const existing = findMessageById(messages, id)
  if (existing?.type === 'text') {
    const current = lastMessage(messages)
    if (current?.streaming && current.id !== id) {
      current.streaming = false
    }
    appendToExistingMessage(existing, chunk)
    mergeMetadata(existing, metadata)
    return
  }

  const current = lastMessage(messages)
  if (canAppendToStreamingText(current) && sameSource(current.metadata, metadata)) {
    current.content += chunk
    current.timestamp = new Date().toISOString()
    mergeMetadata(current, metadata)
    return
  }

  breakStreamingIfNeeded(messages)
  messages.push({
    id,
    type: 'text',
    content: chunk,
    metadata,
    timestamp: new Date().toISOString(),
    streaming: true,
  })
}

function appendStreamingThinking(messages: UIMessage[], chunk: string, id: string, metadata: Record<string, unknown> = {}) {
  const existing = findMessageById(messages, id)
  if (existing?.type === 'thinking') {
    const current = lastMessage(messages)
    if (current?.streaming && current.id !== id) {
      current.streaming = false
    }
    appendToExistingMessage(existing, chunk)
    mergeMetadata(existing, metadata)
    return
  }

  const current = lastMessage(messages)
  if (canAppendToStreamingThinking(current) && sameSource(current.metadata, metadata)) {
    current.content += chunk
    current.timestamp = new Date().toISOString()
    mergeMetadata(current, metadata)
    return
  }

  breakStreamingIfNeeded(messages)
  messages.push({
    id,
    type: 'thinking',
    content: chunk,
    metadata,
    timestamp: new Date().toISOString(),
    streaming: true,
  })
}

function finalizeThinking(messages: UIMessage[]) {
  const current = lastMessage(messages)
  if (isStreamingThinkingMessage(current)) {
    current.streaming = false
  }
}

function finalizeText(messages: UIMessage[]) {
  const current = lastMessage(messages)
  if (isStreamingTextMessage(current)) {
    current.streaming = false
  }
}

function pushBoundaryMessage(messages: UIMessage[]) {
  const current = lastMessage(messages)
  if (current?.streaming) {
    current.streaming = false
  }
}

function clearStreamingState(messages: UIMessage[]) {
  finalizeStreamingMessages(messages)
}

function isBoundaryType(type: string) {
  return isUserVisibleTerminal(type) || isUserText(type)
}

function prepareForBoundary(messages: UIMessage[]) {
  if (lastMessage(messages)?.streaming) {
    lastMessage(messages)!.streaming = false
  }
}

function resetTransientStreaming(messages: UIMessage[]) {
  clearStreamingState(messages)
}

function beforeNonTextMessage(messages: UIMessage[]) {
  prepareForBoundary(messages)
}

function finalizeAllStreaming(messages: UIMessage[]) {
  resetTransientStreaming(messages)
}

function stopTextStreaming(messages: UIMessage[]) {
  finalizeText(messages)
}

function stopThinkingStreaming(messages: UIMessage[]) {
  finalizeThinking(messages)
}

function endStreamingForMessageType(messages: UIMessage[], type: 'text' | 'thinking') {
  if (type === 'text') stopTextStreaming(messages)
  else stopThinkingStreaming(messages)
}

function endAllStreaming(messages: UIMessage[]) {
  finalizeAllStreaming(messages)
}

function handleMessageBoundary(messages: UIMessage[]) {
  beforeNonTextMessage(messages)
}

function resetStreamingOnLoad(msgs: UIMessage[]) {
  for (const msg of msgs) msg.streaming = false
}

function lastStreamingType(messages: UIMessage[]) {
  const current = lastMessage(messages)
  return current?.streaming ? current.type : null
}

function closeStreamingWhenSwitching(messages: UIMessage[], nextType: 'text' | 'thinking') {
  const currentType = lastStreamingType(messages)
  if (currentType && currentType !== nextType) {
    endAllStreaming(messages)
  }
}

function appendAssistantText(messages: UIMessage[], chunk: string, id: string, metadata: Record<string, unknown> = {}) {
  closeStreamingWhenSwitching(messages, 'text')
  appendStreamingText(messages, chunk, id, metadata)
}

function appendAssistantThinking(messages: UIMessage[], chunk: string, id: string, metadata: Record<string, unknown> = {}) {
  closeStreamingWhenSwitching(messages, 'thinking')
  appendStreamingThinking(messages, chunk, id, metadata)
}

function finalizeAssistantStreaming(messages: UIMessage[]) {
  endAllStreaming(messages)
}

function beforePushVisibleMessage(messages: UIMessage[]) {
  handleMessageBoundary(messages)
}

function beforeUserMessage(messages: UIMessage[]) {
  handleMessageBoundary(messages)
}

function finalizeOnStatusChange(messages: UIMessage[], status: CCStatus) {
  if (status === 'idle' || status === 'executing') {
    finalizeAssistantStreaming(messages)
  }
}

function normalizeLoadedMessages(msgs: UIMessage[]) {
  resetStreamingOnLoad(msgs)
}

function resolveLoadedMessageType(message: Message) {
  if (message.type === 'user') return 'user'
  if (message.type === 'text' && message.metadata.role === 'user') return 'user'
  return message.type
}

function normalizeLoadedHistory(msgs: Message[]): UIMessage[] {
  const normalized: UIMessage[] = []

  for (const message of msgs) {
    const type = resolveLoadedMessageType(message)
    const current: UIMessage = {
      id: message.id,
      type,
      content: message.content,
      metadata: message.metadata,
      timestamp: message.createdAt,
      streaming: false,
    }

    const previous = normalized[normalized.length - 1]
    const isMergeableAssistantChunk =
      (type === 'text' || type === 'thinking') &&
      previous?.type === type &&
      sameSource(previous.metadata, current.metadata)

    if (isMergeableAssistantChunk) {
      previous.content += current.content
      previous.timestamp = current.timestamp
      continue
    }

    normalized.push(current)
  }

  return normalized
}

function createVisibleMessage(id: string, type: string, content: string, metadata: Record<string, unknown> = {}): UIMessage {
  return {
    id,
    type,
    content,
    metadata,
    timestamp: new Date().toISOString(),
  }
}

function pushVisibleMessage(messages: UIMessage[], message: UIMessage) {
  beforePushVisibleMessage(messages)
  messages.push(message)
}

function pushUserMessage(messages: UIMessage[], content: string) {
  beforeUserMessage(messages)
  messages.push({
    id: generateId(),
    type: 'user',
    content,
    metadata: { pending: true, localEcho: true },
    timestamp: new Date().toISOString(),
  })
}

function findPendingUserMessage(messages: UIMessage[], content: string) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (
      message.type === 'user' &&
      message.content === content &&
      message.metadata.pending === true
    ) {
      return message
    }
  }
  return undefined
}

function pushErrorMessage(messages: UIMessage[], content: string) {
  pushVisibleMessage(messages, createVisibleMessage(generateId(), 'error', content))
}

function appendOrCreateText(messages: UIMessage[], content: string, id: string, metadata: Record<string, unknown> = {}) {
  appendAssistantText(messages, content, id, metadata)
}

function appendOrCreateThinking(messages: UIMessage[], content: string, id: string, metadata: Record<string, unknown> = {}) {
  appendAssistantThinking(messages, content, id, metadata)
}

function finalizeThinkingIfActive(messages: UIMessage[]) {
  endStreamingForMessageType(messages, 'thinking')
}

function finalizeAll(messages: UIMessage[]) {
  finalizeAssistantStreaming(messages)
}

function onTerminalMessage(messages: UIMessage[]) {
  finalizeAll(messages)
}

function onLoadedMessages(messages: UIMessage[]) {
  normalizeLoadedMessages(messages)
}

function onStatusUpdate(messages: UIMessage[], status: CCStatus) {
  finalizeOnStatusChange(messages, status)
}

function pushMessage(messages: UIMessage[], message: UIMessage) {
  pushVisibleMessage(messages, message)
}

function createTimestamp() {
  return new Date().toISOString()
}

function createPlainMessage(id: string, type: string, content: string, metadata: Record<string, unknown> = {}): UIMessage {
  return { id, type, content, metadata, timestamp: createTimestamp() }
}

function pushPlainMessage(messages: UIMessage[], id: string, type: string, content: string, metadata: Record<string, unknown> = {}) {
  pushMessage(messages, createPlainMessage(id, type, content, metadata))
}

function updateExistingStreamingMessage(messages: UIMessage[], type: 'text' | 'thinking', content: string, id: string, metadata: Record<string, unknown> = {}) {
  if (type === 'text') appendOrCreateText(messages, content, id, metadata)
  else appendOrCreateThinking(messages, content, id, metadata)
}

function stopStreamingForIncomingBoundary(messages: UIMessage[]) {
  onTerminalMessage(messages)
}

function prepareMessagesForLoad(messages: UIMessage[]) {
  onLoadedMessages(messages)
}

function prepareForStatus(messages: UIMessage[], status: CCStatus) {
  onStatusUpdate(messages, status)
}

function pushSimple(messages: UIMessage[], id: string, type: string, content: string, metadata: Record<string, unknown> = {}) {
  stopStreamingForIncomingBoundary(messages)
  pushPlainMessage(messages, id, type, content, metadata)
}

function addStreamingChunk(messages: UIMessage[], type: 'text' | 'thinking', content: string, id: string, metadata: Record<string, unknown> = {}) {
  updateExistingStreamingMessage(messages, type, content, id, metadata)
}

function finishThinking(messages: UIMessage[]) {
  finalizeThinkingIfActive(messages)
}

function finishAll(messages: UIMessage[]) {
  finalizeAll(messages)
}

function pushUser(messages: UIMessage[], content: string) {
  pushUserMessage(messages, content)
}

function pushError(messages: UIMessage[], content: string) {
  pushErrorMessage(messages, content)
}

function createErrorContent(content: string) {
  return content
}

function ensureBoundary(messages: UIMessage[]) {
  stopStreamingForIncomingBoundary(messages)
}

function pushNonStreaming(messages: UIMessage[], id: string, type: string, content: string, metadata: Record<string, unknown> = {}) {
  ensureBoundary(messages)
  pushPlainMessage(messages, id, type, content, metadata)
}

function normalizeOnLoad(messages: UIMessage[]) {
  prepareMessagesForLoad(messages)
}

function finalizeForStatus(messages: UIMessage[], status: CCStatus) {
  prepareForStatus(messages, status)
}

function addStream(messages: UIMessage[], type: 'text' | 'thinking', content: string, id: string, metadata: Record<string, unknown> = {}) {
  addStreamingChunk(messages, type, content, id, metadata)
}

function finalizeThinkingOnly(messages: UIMessage[]) {
  finishThinking(messages)
}

function finalizeEverything(messages: UIMessage[]) {
  finishAll(messages)
}

export const useChatStore = defineStore('chat', () => {
  // messages 是最终给 MessageList 渲染的数据；
  // thinking / processingHintVisible / activeToolUse 则是几个辅助 UI 状态。
  const messages = ref<UIMessage[]>([])
  const session = ref<SessionInfo | null>(null)
  const status = ref<CCStatus>('idle')
  const thinking = ref('')
  const processingHintVisible = ref(false)
  const activeToolUse = ref<ActiveToolUseState | null>(null)
  const hasMoreHistory = ref(false)
  const oldestSeq = ref<number | null>(null)
  const loadingOlderHistory = ref(false)
  const lastMutation = ref<MessageMutationKind>('reset')
  let processingHintTimer: ReturnType<typeof setTimeout> | null = null

  const isProcessing = computed(() => status.value === 'thinking' || status.value === 'executing')
  const processingStatusText = computed(() => {
    switch (status.value) {
      case 'thinking':
        return '正在思考...'
      case 'executing':
        return '正在处理...'
      case 'waiting_confirm':
        return '等待确认...'
      default:
        return ''
    }
  })

  function setSession(s: SessionInfo) {
    session.value = s
  }

  function setHistoryWindow(hasMore: boolean, oldest: number | null) {
    hasMoreHistory.value = hasMore
    oldestSeq.value = oldest
  }

  function clearProcessingHintTimer() {
    if (processingHintTimer) {
      clearTimeout(processingHintTimer)
      processingHintTimer = null
    }
  }

  function hideProcessingHint() {
    clearProcessingHintTimer()
    processingHintVisible.value = false
  }

  function clearProcessingState() {
    hideProcessingHint()
  }

  // 轻微延迟后才显示“处理中”，是为了避免模型很快返回时闪一下提示，
  // 让界面显得过于躁动。
  function scheduleProcessingHint() {
    clearProcessingHintTimer()
    if (status.value === 'idle' || status.value === 'waiting_confirm') return

    processingHintTimer = setTimeout(() => {
      if (status.value !== 'idle' && status.value !== 'waiting_confirm') {
        processingHintVisible.value = true
      }
    }, 600)
  }

  function startProcessingHint() {
    clearProcessingHintTimer()
    processingHintVisible.value = true
  }

  function clearThinkingIndicator() {
    thinking.value = ''
  }

  function setStatus(s: CCStatus) {
    status.value = s
    finalizeForStatus(messages.value, s)
    if (s === 'idle') {
      clearThinkingIndicator()
      clearProcessingState()
      activeToolUse.value = null
      return
    }

    if (s === 'waiting_confirm') {
      hideProcessingHint()
      return
    }

    if (!processingHintVisible.value) {
      scheduleProcessingHint()
    }
  }

  function loadMessages(msgs: Message[], options?: { hasMore?: boolean; oldestSeq?: number | null }) {
    // 历史记录进入 UI 前先归并连续文本块，
    // 不然同一个回答会被数据库里多段流式保存拆成很多气泡。
    messages.value = normalizeLoadedHistory(msgs)
    normalizeOnLoad(messages.value)
    setHistoryWindow(options?.hasMore ?? false, options?.oldestSeq ?? (msgs[0]?.seq ?? null))
    lastMutation.value = 'reset'
  }

  function prependMessages(msgs: Message[], options?: { hasMore?: boolean; oldestSeq?: number | null }) {
    const olderMessages = normalizeLoadedHistory(msgs)
    const existingIds = new Set(messages.value.map(message => message.id))
    const nextOlder = olderMessages.filter(message => !existingIds.has(message.id))
    messages.value = [...nextOlder, ...messages.value]
    normalizeOnLoad(messages.value)
    setHistoryWindow(options?.hasMore ?? false, options?.oldestSeq ?? (msgs[0]?.seq ?? oldestSeq.value))
    lastMutation.value = 'prepend'
  }

  function setLoadingOlderHistory(value: boolean) {
    loadingOlderHistory.value = value
  }

  function addMessage(msg: ServerMsg & { type: string }) {
    // 这里专门处理服务端实时消息到 UI 的映射关系。
    // 文本/思考类消息走流式合并；工具卡片、错误、确认框则作为边界消息直接入列。
    switch (msg.type) {
      case 'user':
        lastMutation.value = 'append'
        {
          const pendingMessage = findPendingUserMessage(messages.value, msg.content)
          if (pendingMessage) {
            pendingMessage.id = msg.messageId
            pendingMessage.metadata = {}
            pendingMessage.timestamp = new Date().toISOString()
            break
          }
          pushNonStreaming(messages.value, msg.messageId, 'user', msg.content)
        }
        break
      case 'text':
        lastMutation.value = 'append'
        hideProcessingHint()
        scheduleProcessingHint()
        clearThinkingIndicator()
        addStream(
          messages.value,
          'text',
          msg.content,
          msg.messageId,
          withIncomingSourceMetadata({}, msg.source, msg.sourceLabel, msg.sourceAgent, msg.sourceAgentLabel),
        )
        break
      case 'thinking':
        lastMutation.value = 'append'
        hideProcessingHint()
        scheduleProcessingHint()
        clearThinkingIndicator()
        addStream(
          messages.value,
          'thinking',
          msg.content,
          msg.messageId,
          withIncomingSourceMetadata({}, msg.source, msg.sourceLabel, msg.sourceAgent, msg.sourceAgentLabel),
        )
        break
      case 'thinking_done':
        finalizeThinkingOnly(messages.value)
        clearThinkingIndicator()
        break
      case 'code':
        lastMutation.value = 'append'
        hideProcessingHint()
        scheduleProcessingHint()
        clearThinkingIndicator()
        pushNonStreaming(
          messages.value,
          msg.messageId,
          'code',
          msg.content,
          withIncomingSourceMetadata({ language: msg.lang }, msg.source, msg.sourceLabel, msg.sourceAgent, msg.sourceAgentLabel),
        )
        break
      case 'diff':
        lastMutation.value = 'append'
        hideProcessingHint()
        scheduleProcessingHint()
        clearThinkingIndicator()
        pushNonStreaming(
          messages.value,
          msg.messageId,
          'diff',
          msg.content,
          withIncomingSourceMetadata({}, msg.source, msg.sourceLabel, msg.sourceAgent, msg.sourceAgentLabel),
        )
        break
      case 'tool_use':
        lastMutation.value = 'append'
        hideProcessingHint()
        scheduleProcessingHint()
        clearThinkingIndicator()
        activeToolUse.value = {
          toolName: msg.toolName,
          toolInput: msg.toolInput || {},
          sourceLabel: msg.sourceLabel || (msg.source ? sourceLabelFrom(msg.source) : undefined),
        }
        pushNonStreaming(
          messages.value,
          msg.messageId,
          'tool_use',
          '',
          withIncomingSourceMetadata(
            {
              toolName: msg.toolName,
              toolInput: msg.toolInput,
            },
            msg.source,
            msg.sourceLabel,
            msg.sourceAgent,
            msg.sourceAgentLabel,
          ),
        )
        break
      case 'tool_result':
        lastMutation.value = 'append'
        hideProcessingHint()
        scheduleProcessingHint()
        clearThinkingIndicator()
        pushNonStreaming(
          messages.value,
          msg.messageId,
          'tool_result',
          msg.content,
          withIncomingSourceMetadata({ parentId: msg.parentId }, msg.source, msg.sourceLabel, msg.sourceAgent, msg.sourceAgentLabel),
        )
        break
      case 'confirm_request':
        lastMutation.value = 'append'
        hideProcessingHint()
        clearThinkingIndicator()
        pushNonStreaming(messages.value, msg.requestId, 'confirm_request', msg.message, { toolName: msg.toolName, requestId: msg.requestId })
        break
      case 'error':
        lastMutation.value = 'append'
        clearProcessingState()
        clearThinkingIndicator()
        activeToolUse.value = null
        pushNonStreaming(
          messages.value,
          (msg as any).messageId || generateId(),
          'error',
          msg.message,
          withIncomingSourceMetadata({}, msg.source, msg.sourceLabel, msg.sourceAgent, msg.sourceAgentLabel),
        )
        break
    }
  }

  function sendInput(text: string, mode: ToolExecutionMode = 'auto', mentions: AgentMention[] = []) {
    const ws = useWSStore()
    if (!session.value) {
      pushError(messages.value, createErrorContent('No active session. Please select or create a session.'))
      status.value = 'idle'
      return
    }

    const ok = ws.send({ type: 'input', text, sessionId: session.value.id, mode, mentions })
    if (ok) {
      pushUser(messages.value, text)
      lastMutation.value = 'append'
      startProcessingHint()
      status.value = 'thinking'
    } else {
      pushError(messages.value, createErrorContent('Not connected to server'))
      status.value = 'idle'
      clearThinkingIndicator()
      clearProcessingState()
    }
  }

  function confirmRequest(requestId: string, allow: boolean) {
    const ws = useWSStore()
    ws.send({ type: 'confirm', requestId, allow, sessionId: session.value?.id })
    messages.value = messages.value.filter(m => m.id !== requestId)
    if (status.value !== 'idle') {
      startProcessingHint()
    }
  }

  function cancelRequest() {
    const ws = useWSStore()
    ws.send({ type: 'cancel', sessionId: session.value?.id })
  }

  function clearMessages() {
    finalizeEverything(messages.value)
    messages.value = []
    setHistoryWindow(false, null)
    lastMutation.value = 'reset'
    clearThinkingIndicator()
    clearProcessingState()
    activeToolUse.value = null
  }

  return {
    messages,
    session,
    status,
    thinking,
    processingHintVisible,
    processingStatusText,
    activeToolUse,
    hasMoreHistory,
    oldestSeq,
    loadingOlderHistory,
    lastMutation,
    isProcessing,
    setSession,
    setStatus,
    loadMessages,
    prependMessages,
    setLoadingOlderHistory,
    addMessage,
    sendInput,
    confirmRequest,
    cancelRequest,
    clearMessages,
  }
})
