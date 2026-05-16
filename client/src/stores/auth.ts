import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/utils/api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)

  const isAuthenticated = computed(() => !!token.value)

  function checkStoredToken() {
    const stored = localStorage.getItem('cc-token')
    if (stored) token.value = stored
  }

  async function login(password: string) {
    const result = await api.login(password)
    token.value = result.token
    localStorage.setItem('cc-token', result.token)
  }

  function logout() {
    token.value = null
    localStorage.removeItem('cc-token')
  }

  return { token, isAuthenticated, checkStoredToken, login, logout }
})
