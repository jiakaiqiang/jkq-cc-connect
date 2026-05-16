<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import { useWSStore } from '@/stores/ws'
import { useAuthStore } from '@/stores/auth'
import { useVibeStore } from '@/stores/vibe'
import { api } from '@/utils/api'
import ChatHeader from '@/components/chat/ChatHeader.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatInput from '@/components/chat/ChatInput.vue'

const route = useRoute()
const router = useRouter()
const chat = useChatStore()
const ws = useWSStore()
const auth = useAuthStore()
const vibe = useVibeStore()

let bindVersion = 0

async function ensureDefaultSession() {
  const sessions = await api.getSessions()
  const activeSession = sessions.find(session => session.status === 'active')
  if (activeSession) return activeSession

  const roots = await api.getFileRoots()
  const root = roots[0]
  if (!root) throw new Error('No allowed project directory')

  const session = await api.createSession(root.path)
  vibe.setMode('claude')
  return session
}

async function bindSession() {
  const version = ++bindVersion
  const sessionId = typeof route.params.id === 'string' ? route.params.id : null
  chat.clearMessages()

  if (!auth.isAuthenticated) return

  if (sessionId) {
    ws.joinSession(sessionId)
    return
  }

  try {
    const session = await ensureDefaultSession()
    if (version !== bindVersion) return
    router.replace(`/chat/${session.id}`)
  } catch (err) {
    if (version !== bindVersion) return
    ws.connect()
    chat.addMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Failed to create session',
    } as any)
  }
}

onMounted(() => {
  bindSession()
})

watch(() => auth.isAuthenticated, (val) => {
  if (val) bindSession()
})

watch(() => route.params.id, () => {
  bindSession()
})
</script>

<template>
  <div class="flex flex-col h-full">
    <ChatHeader />
    <MessageList />
    <ChatInput />
  </div>
</template>
