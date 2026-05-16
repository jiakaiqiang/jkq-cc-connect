import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useChatStore } from './chat'
import { useVibeStore } from './vibe'
import type { ClientMsg, ServerMsg, ToolExecutionMode } from '@/types'
import { getServerRequirementMessage, getWebSocketUrl } from '@/utils/server'

export const useWSStore = defineStore('ws', () => {
  // 这几个 ref 是给 UI 直接消费的连接状态。
  // 真正的 WebSocket 实例和计时器仍然保留在闭包里，避免被组件误操作。
  const connected = ref(false)
  const auth = ref(false)
  const currentSessionId = ref<string | null>(null)
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let manualDisconnect = false

  // connect 负责“从 0 到 1”建立连接，也负责重连场景。
  // 如果当前已经连上，就只补发 join_session，不重复 new WebSocket。
  function connect(sessionId?: string) {
    manualDisconnect = false
    if (sessionId) currentSessionId.value = sessionId

    const token = localStorage.getItem('cc-token')
    if (!token) return
    if (ws?.readyState === WebSocket.OPEN) {
      if (currentSessionId.value) send({ type: 'join_session', sessionId: currentSessionId.value })
      return
    }

    const url = getWebSocketUrl()
    if (!url) {
      useChatStore().setStatus('idle')
      console.warn(getServerRequirementMessage())
      return
    }

    ws = new WebSocket(url)

    ws.onopen = () => {
      connected.value = true
      // 连接建立后第一件事是鉴权；
      // 鉴权通过后服务端才允许加入具体 session。
      send({ type: 'auth', token })
      pingTimer = setInterval(() => {
        send({ type: 'ping' })
      }, 25000)
    }

    ws.onmessage = (event) => {
      try {
        const msg: ServerMsg = JSON.parse(event.data)
        handleMessage(msg)
      } catch { /* ignore parse errors */ }
    }

    ws.onclose = () => {
      connected.value = false
      auth.value = false
      if (pingTimer) clearInterval(pingTimer)
      pingTimer = null
      ws = null
      if (!manualDisconnect) {
        // 自动重连只在“意外断开”时触发，避免用户主动退出后又被偷偷拉起来。
        reconnectTimer = setTimeout(() => connect(currentSessionId.value || undefined), 3000)
      }
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  function joinSession(sessionId: string) {
    currentSessionId.value = sessionId
    // 如果已经 auth 完成就直接 join；否则先建立连接，等 auth_ok 后再 join。
    if (auth.value) {
      send({ type: 'join_session', sessionId })
    } else {
      connect(sessionId)
    }
  }

  function reconnect(sessionId?: string) {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    manualDisconnect = false
    if (sessionId) currentSessionId.value = sessionId

    if (ws?.readyState === WebSocket.OPEN) {
      if (currentSessionId.value) send({ type: 'join_session', sessionId: currentSessionId.value })
      return
    }

    ws?.close()
    ws = null
    connect(currentSessionId.value || undefined)
  }

  function send(msg: ClientMsg): boolean {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
      return true
    }
    return false
  }

  function setSessionMode(mode: ToolExecutionMode) {
    if (!currentSessionId.value) return false
    return send({ type: 'set_mode', sessionId: currentSessionId.value, mode })
  }

  function handleMessage(msg: ServerMsg) {
    const chat = useChatStore()
    const vibe = useVibeStore()

    // 这里只做“分发”和少量连接态同步，不承载具体 UI 逻辑。
    // 真正的消息归并、流式渲染、状态展示都交给 chat store 处理。
    switch (msg.type) {
      case 'auth_ok':
        auth.value = true
        if (currentSessionId.value) {
          send({ type: 'join_session', sessionId: currentSessionId.value })
        }
        break
      case 'auth_error':
        auth.value = false
        localStorage.removeItem('cc-token')
        break
      case 'mode_changed':
        vibe.setMode(msg.mode, false)
        break
      case 'session_state':
        chat.setSession(msg.session)
        chat.loadMessages(msg.messages, { hasMore: msg.hasMore, oldestSeq: msg.oldestSeq })
        break
      case 'session_updated':
        chat.setSession(msg.session)
        break
      case 'status':
        chat.setStatus(msg.state)
        if (msg.state === 'idle') {
          vibe.clearActiveMode()
        }
        break
      case 'user':
      case 'text':
      case 'thinking':
      case 'thinking_done':
      case 'code':
      case 'diff':
      case 'tool_use':
      case 'tool_result':
      case 'confirm_request':
      case 'error':
        chat.addMessage(msg)
        break
      case 'pong':
        break
    }
  }

  function disconnect() {
    manualDisconnect = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = null
    ws?.close()
    ws = null
    connected.value = false
    auth.value = false
  }

  return { connected, auth, currentSessionId, connect, joinSession, reconnect, send, setSessionMode, disconnect }
})
