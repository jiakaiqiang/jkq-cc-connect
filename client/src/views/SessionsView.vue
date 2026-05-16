<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWSStore } from '@/stores/ws'
import { api } from '@/utils/api'
import { formatDateTime, formatSessionDisplayName } from '@/utils/date'
import type { SessionInfo } from '@/types'

const router = useRouter()
const ws = useWSStore()
const sessions = ref<SessionInfo[]>([])
const loading = ref(true)
const closingSessionId = ref<string | null>(null)

const activeCount = computed(() => sessions.value.filter(item => item.status === 'active').length)
const archivedCount = computed(() => sessions.value.length - activeCount.value)

onMounted(loadSessions)

async function loadSessions() {
  loading.value = true
  try {
    sessions.value = await api.getSessions()
  } catch { /* ignore */ }
  loading.value = false
}

function openSession(id: string) {
  router.push(`/chat/${id}`)
}

function reconnectSession(id: string) {
  ws.reconnect(id)
  router.push(`/chat/${id}`)
}

function isCurrentSession(id: string) {
  return ws.currentSessionId === id
}

function isConnectedSession(id: string) {
  return ws.connected && isCurrentSession(id)
}

function canReconnect(session: SessionInfo) {
  return session.status === 'active' && !ws.connected
}

function canDisconnect(id: string) {
  return isConnectedSession(id)
}

function disconnectSession(id: string) {
  if (!canDisconnect(id)) return
  ws.disconnect()
}

async function closeSession(session: SessionInfo) {
  if (closingSessionId.value) return

  const ok = window.confirm(
    `\u786e\u5b9a\u8981\u5220\u9664 ${formatSessionDisplayName(session.name, session.lastActive)} \u5417\uff1f\u6b64\u64cd\u4f5c\u4f1a\u5220\u9664\u8be5 session \u7684\u6240\u6709\u6d88\u606f\u3002`,
  )
  if (!ok) return

  closingSessionId.value = session.id
  try {
    await api.deleteSession(session.id)
    sessions.value = sessions.value.filter(item => item.id !== session.id)
    if (isCurrentSession(session.id)) {
      ws.disconnect()
    }
  } catch { /* ignore */ }
  finally {
    closingSessionId.value = null
  }
}
</script>

<template>
  <div class="flex h-full flex-col bg-[#f5f6f7] text-[#1f2329]">
    <header class="shrink-0 border-b border-[#dee0e3] bg-white/95 px-4 py-3">
      <div class="mx-auto flex max-w-3xl items-center gap-3">
        <button
          @click="router.push('/chat')"
          class="grid h-9 w-9 place-items-center rounded-md text-[#646a73] transition-colors hover:bg-[#f2f3f5] hover:text-[#1f2329] cursor-pointer"
          aria-label="Back to chat"
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div class="min-w-0 flex-1">
          <h2 class="text-base font-semibold leading-6 text-[#1f2329]">Sessions</h2>
          <p class="text-xs leading-5 text-[#86909c]">
            {{ activeCount }} active / {{ archivedCount }} archived
          </p>
        </div>
        <span
          class="rounded-full px-2.5 py-1 text-xs font-medium"
          :class="ws.connected ? 'bg-[#e8f3ff] text-[#1456f0]' : 'bg-[#f2f3f5] text-[#646a73]'"
        >
          {{ ws.connected ? 'Connected' : 'Offline' }}
        </span>
      </div>
    </header>

    <main class="flex-1 overflow-y-auto px-3 py-4">
      <div class="mx-auto max-w-3xl">
        <div
          v-if="loading"
          class="rounded-lg border border-[#eff0f1] bg-white px-4 py-10 text-center text-sm text-[#86909c]"
        >
          Loading...
        </div>

        <div
          v-else-if="sessions.length === 0"
          class="rounded-lg border border-[#eff0f1] bg-white px-4 py-10 text-center text-sm text-[#86909c]"
        >
          No sessions yet
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="s in sessions"
            :key="s.id"
            class="rounded-lg border border-[#eff0f1] bg-white px-3 py-3 shadow-[0_1px_2px_rgba(31,35,41,0.04)] transition-colors hover:border-[#dee0e3]"
          >
            <div class="flex items-start gap-3">
              <button
                @click="openSession(s.id)"
                class="min-w-0 flex-1 text-left cursor-pointer"
              >
                <div class="flex items-center gap-2">
                  <span
                    class="h-2 w-2 shrink-0 rounded-full"
                    :class="isConnectedSession(s.id) ? 'bg-[#1456f0]' : s.status === 'active' ? 'bg-[#00b42a]' : 'bg-[#c9cdd4]'"
                  />
                  <p class="truncate text-sm font-medium text-[#1f2329]">{{ formatSessionDisplayName(s.name, s.lastActive) }}</p>
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-4 text-xs text-[#86909c]">
                  <span>{{ formatDateTime(s.lastActive) }}</span>
                  <span
                    class="rounded-full px-2 py-0.5"
                    :class="isConnectedSession(s.id)
                      ? 'bg-[#e8f3ff] text-[#1456f0]'
                      : s.status === 'active'
                        ? 'bg-[#e8ffea] text-[#008a22]'
                        : 'bg-[#f2f3f5] text-[#646a73]'"
                  >
                    {{ isConnectedSession(s.id) ? 'Connected' : s.status === 'active' ? 'Active' : 'Archived' }}
                  </span>
                </div>
              </button>

              <div class="flex shrink-0 items-center gap-1">
                <button
                  @click.stop="reconnectSession(s.id)"
                  :disabled="!canReconnect(s)"
                  class="h-8 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:border-[#dee0e3] disabled:bg-[#f7f8fa] disabled:text-[#c9cdd4] enabled:cursor-pointer enabled:border-[#1456f0] enabled:bg-[#1456f0] enabled:text-white enabled:hover:bg-[#0f49d2]"
                  title="Reconnect session"
                >
                  &#37325;&#36830;
                </button>
                <button
                  @click.stop="disconnectSession(s.id)"
                  :disabled="!canDisconnect(s.id)"
                  class="h-8 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:border-[#dee0e3] disabled:bg-[#f7f8fa] disabled:text-[#c9cdd4] enabled:cursor-pointer enabled:border-[#f7ba1e] enabled:bg-[#fff7e8] enabled:text-[#ad6800] enabled:hover:bg-[#fff1d6]"
                  title="Disconnect current session"
                >
                  &#26029;&#24320;
                </button>
                <button
                  @click.stop="closeSession(s)"
                  :disabled="closingSessionId === s.id"
                  class="h-8 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:border-[#dee0e3] disabled:bg-[#f7f8fa] disabled:text-[#c9cdd4] enabled:cursor-pointer enabled:border-[#f54a45] enabled:bg-white enabled:text-[#d83931] enabled:hover:bg-[#fff0f0]"
                  title="Delete session and messages"
                >
                  &#20851;&#38381;
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
