<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useWSStore } from '@/stores/ws'
import { backendConfig } from '@/config/backend'
import { api } from '@/utils/api'
import {
  getConfiguredServerBase,
  getCurrentOriginServerBase,
  setConfiguredServerBase,
  shouldRequireConfiguredServer,
} from '@/utils/server'

const router = useRouter()
const auth = useAuthStore()
const ws = useWSStore()

const serverUrl = ref(getConfiguredServerBase())
const newPassword = ref('')
const confirmPassword = ref('')
const allowedRootsText = ref('')
const message = ref('')
const error = ref('')
const checkingServer = ref(false)
const requireConfiguredServer = computed(() => shouldRequireConfiguredServer())

onMounted(async () => {
  try {
    const settings = await api.getSettings()
    allowedRootsText.value = settings.allowedRoots.join('\n')
  } catch { /* ignore */ }
})

async function changePassword() {
  error.value = ''
  message.value = ''

  if (!newPassword.value || newPassword.value.length < 4) {
    error.value = 'Password too short (min 4 chars)'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Passwords do not match'
    return
  }

  try {
    await api.changePassword(newPassword.value)
    message.value = 'Password changed successfully'
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (e: any) {
    error.value = e.message || 'Failed to change password'
  }
}

async function updateAllowedRoots() {
  error.value = ''
  message.value = ''

  const allowedRoots = allowedRootsText.value
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)

  if (allowedRoots.length === 0) {
    error.value = 'At least one root is required'
    return
  }

  try {
    const settings = await api.updateSettings(allowedRoots)
    allowedRootsText.value = settings.allowedRoots.join('\n')
    message.value = 'Allowed roots updated'
  } catch (e: any) {
    error.value = e.message || 'Failed to update allowed roots'
  }
}

async function saveServerUrl() {
  error.value = ''
  message.value = ''

  const previous = getConfiguredServerBase()
  const next = setConfiguredServerBase(serverUrl.value)
  serverUrl.value = next

  if (previous !== next) {
    auth.logout()
    ws.disconnect()
    message.value = '电脑服务地址已更新，请重新登录'
    router.push('/login')
    return
  }

  message.value = next ? '电脑服务地址已保存' : '已恢复为当前网页地址'
}

async function testServer() {
  error.value = ''
  message.value = ''
  checkingServer.value = true

  try {
    const normalized = setConfiguredServerBase(serverUrl.value)
    serverUrl.value = normalized
    const health = await api.pingServer(normalized || undefined)
    message.value = `连接成功，服务时间 ${health.serverTime}`
  } catch (e: any) {
    error.value = e.message || '无法连接到电脑服务'
  } finally {
    checkingServer.value = false
  }
}

function handleLogout() {
  auth.logout()
  ws.disconnect()
  router.push('/login')
}
</script>

<template>
  <div class="flex flex-col h-full">
    <header class="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
      <button @click="router.push('/chat')" class="text-gray-400 hover:text-white">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h2 class="text-sm font-medium text-white">Settings</h2>
    </header>

    <div class="flex-1 overflow-y-auto px-4 py-6 space-y-6">
      <section>
        <h3 class="text-sm font-medium text-gray-300 mb-3">Computer Server</h3>
        <div v-if="requireConfiguredServer" class="space-y-3">
          <input
            v-model="serverUrl"
            type="text"
            :placeholder="backendConfig.examples.lanServerBase"
            class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <div class="grid grid-cols-2 gap-3">
            <button
              @click="saveServerUrl"
              class="w-full py-2 border border-gray-700 hover:bg-gray-800 rounded-lg text-white text-sm font-medium transition-colors"
            >
              Save Server
            </button>
            <button
              @click="testServer"
              :disabled="checkingServer"
              class="w-full py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-60 rounded-lg text-white text-sm font-medium transition-colors"
            >
              {{ checkingServer ? 'Checking...' : 'Test Server' }}
            </button>
          </div>
          <p v-if="error" class="text-red-400 text-xs">{{ error }}</p>
          <p v-if="message" class="text-green-400 text-xs">{{ message }}</p>
        </div>
        <div v-else class="rounded-lg border border-gray-800 bg-gray-900/70 px-3 py-3 text-sm text-gray-300">
          浏览器模式会自动使用当前站点地址：`{{ getCurrentOriginServerBase() }}`
        </div>
      </section>

      <section>
        <h3 class="text-sm font-medium text-gray-300 mb-3">Allowed Roots</h3>
        <div class="space-y-3">
          <textarea
            v-model="allowedRootsText"
            rows="5"
            placeholder="One path per line, e.g. D:/"
            class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            @click="updateAllowedRoots"
            class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-sm font-medium transition-colors"
          >
            Update Allowed Roots
          </button>
        </div>
      </section>

      <section>
        <h3 class="text-sm font-medium text-gray-300 mb-3">Change Password</h3>
        <div class="space-y-3">
          <input
            v-model="newPassword"
            type="password"
            placeholder="New password"
            class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <input
            v-model="confirmPassword"
            type="password"
            placeholder="Confirm new password"
            class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            @click="changePassword"
            class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-sm font-medium transition-colors"
          >
            Update Password
          </button>
        </div>
      </section>

      <section>
        <button
          @click="handleLogout"
          class="w-full py-2 border border-red-700 text-red-400 hover:bg-red-900/20 rounded-lg text-sm font-medium transition-colors"
        >
          Sign Out
        </button>
      </section>
    </div>
  </div>
</template>
