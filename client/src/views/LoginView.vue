<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { backendConfig } from '@/config/backend'
import { api } from '@/utils/api'
import {
  getCurrentOriginServerBase,
  getConfiguredServerBase,
  getServerRequirementMessage,
  setConfiguredServerBase,
  shouldRequireConfiguredServer,
} from '@/utils/server'

const router = useRouter()
const auth = useAuthStore()

const password = ref('')
const serverUrl = ref(getConfiguredServerBase())
const error = ref('')
const loading = ref(false)
const serverMessage = ref('')
const serverError = ref('')
const checkingServer = ref(false)
const requireConfiguredServer = computed(() => shouldRequireConfiguredServer())

async function saveServerUrl() {
  serverError.value = ''
  serverMessage.value = ''

  const normalized = setConfiguredServerBase(serverUrl.value)
  serverUrl.value = normalized

  if (shouldRequireConfiguredServer() && !normalized) {
    serverError.value = getServerRequirementMessage()
    return false
  }

  serverMessage.value = normalized ? '电脑服务地址已保存' : '已恢复为当前网页地址'
  return true
}

async function testServer() {
  serverError.value = ''
  serverMessage.value = ''
  checkingServer.value = true

  try {
    const normalized = serverUrl.value.trim() ? setConfiguredServerBase(serverUrl.value) : getConfiguredServerBase()
    serverUrl.value = normalized
    const health = await api.pingServer(normalized || undefined)
    serverMessage.value = `连接成功，服务时间 ${health.serverTime}`
  } catch (e: any) {
    serverError.value = e.message || '无法连接到电脑服务'
  } finally {
    checkingServer.value = false
  }
}

async function handleLogin() {
  if (!password.value) return
  loading.value = true
  error.value = ''
  try {
    if (requireConfiguredServer.value) {
      const saved = await saveServerUrl()
      if (!saved) return
    }
    await auth.login(password.value)
    router.push('/chat')
  } catch (e: any) {
    error.value = e.message || 'Login failed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col items-center justify-center h-full px-6">
    <div class="w-full max-w-sm">
      <div class="text-center mb-8">
        <div class="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </div>
        <h1 class="text-xl font-semibold text-white">CC Connect</h1>
        <p class="text-sm text-gray-400 mt-1">Sign in to control Claude Code</p>
      </div>

      <form @submit.prevent="handleLogin" class="space-y-4">
        <div v-if="requireConfiguredServer" class="space-y-2 rounded-2xl border border-gray-800 bg-gray-900/80 p-4">
          <div>
            <p class="text-sm font-medium text-white">电脑服务地址</p>
            <p class="mt-1 text-xs leading-5 text-gray-400">
              APK 需要连接到电脑上的服务，例如 `{{ backendConfig.examples.lanServerBase }}`
            </p>
          </div>

          <input
            v-model="serverUrl"
            type="text"
            :placeholder="backendConfig.examples.lanServerBase"
            class="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />

          <div class="grid grid-cols-2 gap-3">
            <button
              type="button"
              @click="saveServerUrl"
              class="rounded-xl border border-gray-700 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-800"
            >
              保存地址
            </button>
            <button
              type="button"
              :disabled="checkingServer"
              @click="testServer"
              class="rounded-xl bg-gray-800 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-60"
            >
              {{ checkingServer ? '检测中...' : '测试连接' }}
            </button>
          </div>

          <p v-if="serverError" class="text-sm text-red-400">{{ serverError }}</p>
          <p v-else-if="serverMessage" class="text-sm text-emerald-400">{{ serverMessage }}</p>
        </div>

        <div v-else class="rounded-2xl border border-gray-800 bg-gray-900/60 px-4 py-3 text-xs leading-5 text-gray-400">
          浏览器访问会自动连接当前站点：`{{ getCurrentOriginServerBase() }}`
        </div>

        <div>
          <input
            v-model="password"
            type="password"
            placeholder="Enter password"
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 text-center"
            autofocus
          />
        </div>

        <p v-if="error" class="text-red-400 text-sm text-center">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading || !password"
          class="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-white font-medium transition-colors"
        >
          {{ loading ? 'Signing in...' : 'Sign In' }}
        </button>
      </form>
    </div>
  </div>
</template>
