import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/utils/api'
import type { ToolExecutionMode, VibeToolInfo } from '@/types'

const STORAGE_KEY = 'cc-vibe-mode'

function loadInitialMode(): ToolExecutionMode {
  const value = localStorage.getItem(STORAGE_KEY)
  if (value === 'auto' || value === 'parallel' || value === 'claude' || value === 'codex' || value === 'opencode') {
    return value
  }
  return 'auto'
}

function hasNegativeCue(input: string) {
  return /(不要|别用|not\s+use|don't use|dont use)/i.test(input)
}

function matchesIntent(input: string, aliases: string[]) {
  const joined = aliases.map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const direct = new RegExp(`(?:切换到|切到|换到|换成|改用|使用|通过|交给|switch to|use|change to)\\s*(?:the\\s+)?(?:cli\\s+)?(?:工具\\s*)?(?:${joined})`, 'i')
  const reverse = new RegExp(`(?:${joined}).{0,8}(?:来处理|回答|执行|run|reply|handle|做这个|做这次|模式)`, 'i')
  return direct.test(input) || reverse.test(input)
}

export function detectModeFromNaturalLanguage(text: string): ToolExecutionMode | null {
  const input = text.trim().toLowerCase()
  if (!input || input.startsWith('/')) return null
  if (hasNegativeCue(input)) return null

  if (/(自动模式|auto mode|切回自动|切换到自动|用自动)/.test(input)) return 'auto'
  if (/(并行模式|parallel mode|切换到并行|切到并行|用并行)/.test(input)) return 'parallel'

  if (matchesIntent(input, ['claude', '克劳德'])) return 'claude'
  if (matchesIntent(input, ['codex', 'code x'])) return 'codex'
  if (matchesIntent(input, ['opencode', 'open code', 'open-code'])) return 'opencode'

  return null
}

export const useVibeStore = defineStore('vibe', () => {
  const tools = ref<VibeToolInfo[]>([])
  const loading = ref(false)
  const preferredMode = ref<ToolExecutionMode>(loadInitialMode())
  const activeMode = ref<ToolExecutionMode | null>(null)
  const lastLoadedAt = ref<string | null>(null)

  const selectedMode = computed(() => activeMode.value || preferredMode.value)
  const autoParallelSummaryEnabled = computed(() => selectedMode.value === 'auto')

  const toolsById = computed(() => {
    const map = new Map<VibeToolInfo['id'], VibeToolInfo>()
    for (const tool of tools.value) map.set(tool.id, tool)
    return map
  })

  const autoSummary = computed(() => {
    const readyTools = tools.value.filter(tool => tool.supportsExecution)
    if (readyTools.length === 0) {
      return '当前没有可直接执行的工具，自动模式会等待工具可用后再由 Claude 汇总。'
    }
    if (readyTools.length === 1) {
      return `自动模式当前可用工具为 ${readyTools[0].label}，结果会由 Claude 汇总输出。`
    }
    return `自动模式会在 ${readyTools.map(tool => tool.label).join('、')} 之间智能路由，并由 Claude 汇总输出。`
  })

  async function loadTools() {
    loading.value = true
    try {
      tools.value = await api.getVibeTools()
      lastLoadedAt.value = new Date().toISOString()
    } finally {
      loading.value = false
    }
  }

  function setMode(mode: ToolExecutionMode, persist = true) {
    if (persist) {
      preferredMode.value = mode
      activeMode.value = null
    } else {
      activeMode.value = mode
    }
    if (!persist) return
    localStorage.setItem(STORAGE_KEY, mode)
  }

  function clearActiveMode() {
    activeMode.value = null
  }

  return {
    tools,
    loading,
    preferredMode,
    activeMode,
    selectedMode,
    lastLoadedAt,
    toolsById,
    autoSummary,
    autoParallelSummaryEnabled,
    loadTools,
    setMode,
    clearActiveMode,
  }
})
