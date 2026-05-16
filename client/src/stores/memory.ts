import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/utils/api'
import type { ConversationState } from '@/types'

export const useMemoryStore = defineStore('memory', () => {
  const current = ref<ConversationState | null>(null)
  const loading = ref(false)

  async function load(sessionId: string) {
    loading.value = true
    try {
      current.value = await api.getSessionMemory(sessionId)
    } finally {
      loading.value = false
    }
  }

  function clear() {
    current.value = null
    loading.value = false
  }

  return {
    current,
    loading,
    load,
    clear,
  }
})
