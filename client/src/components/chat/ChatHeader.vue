<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import { useMemoryStore } from '@/stores/memory'
import { useWSStore } from '@/stores/ws'
import { useVibeStore } from '@/stores/vibe'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { formatSessionDisplayName } from '@/utils/date'
import type { ToolAgentInfo, ToolExecutionMode, VibeToolInfo, VibeToolState } from '@/types'

type HeaderPanelId = 'cli' | 'memory' | 'agents'

type MemorySection = {
  id: string
  title: string
  preview: string
  kind: 'text' | 'list'
  items?: string[]
  text?: string
}

const router = useRouter()
const chat = useChatStore()
const memory = useMemoryStore()
const ws = useWSStore()
const vibe = useVibeStore()

const managementPanelOpen = ref(false)
const activePanel = ref<HeaderPanelId>('cli')
const expandedMemoryIds = ref<string[]>([])
const expandedAgentGroupIds = ref<string[]>([])
const expandedAgentIds = ref<string[]>([])

const sessionTitle = computed(() => {
  return chat.session ? formatSessionDisplayName(chat.session.name, chat.session.lastActive) : 'CC Connect'
})

const currentSessionId = computed(() => chat.session?.id || '')

const statusTool = computed<VibeToolInfo | null>(() => {
  if (vibe.selectedMode === 'claude' || vibe.selectedMode === 'codex' || vibe.selectedMode === 'opencode') {
    return vibe.toolsById.get(vibe.selectedMode) || null
  }
  return vibe.toolsById.get('claude') || null
})

const statusToolLabel = computed(() => statusTool.value?.label || 'Claude')
const statusToolOnline = computed(() => {
  if (!ws.connected || !ws.auth) return false
  if (!statusTool.value) return true
  return statusTool.value.supportsExecution || statusTool.value.state === 'ready'
})

const selectedModeLabel = computed(() => {
  return modeTabs.value.find(tab => tab.id === vibe.selectedMode)?.label || '自动'
})

const modeTabs = computed(() => [
  { id: 'auto' as ToolExecutionMode, label: '自动', state: 'ready' as VibeToolState, statusText: '智能路由' },
  ...vibe.tools.map(tool => ({
    id: tool.id as ToolExecutionMode,
    label: tool.label,
    state: tool.state,
    statusText: tool.statusText,
  })),
  { id: 'parallel' as ToolExecutionMode, label: '并行', state: 'limited' as VibeToolState, statusText: 'Claude 汇总' },
])

const memoryManageDisabled = computed(() => !currentSessionId.value)

const memorySections = computed<MemorySection[]>(() => {
  const state = memory.current
  if (!state) return []

  return [
    {
      id: 'working',
      title: '工作记忆',
      preview: state.workingMemory || '暂无工作记忆',
      kind: 'text',
      text: state.workingMemory || '暂无工作记忆',
    },
    {
      id: 'summary',
      title: '会话摘要',
      preview: state.canonicalSummary || '暂无会话摘要',
      kind: 'text',
      text: state.canonicalSummary || '暂无会话摘要',
    },
    {
      id: 'goal',
      title: '当前目标',
      preview: state.currentGoal || '暂无当前目标',
      kind: 'text',
      text: state.currentGoal || '暂无当前目标',
    },
    {
      id: 'decisions',
      title: '近期决策',
      preview: state.recentDecisions[0] || '暂无近期决策',
      kind: 'list',
      items: state.recentDecisions,
    },
    {
      id: 'files',
      title: '涉及文件',
      preview: state.touchedFiles[0] || '暂无涉及文件',
      kind: 'list',
      items: state.touchedFiles,
    },
    {
      id: 'questions',
      title: '待处理问题',
      preview: state.openQuestions[0] || '暂无待处理问题',
      kind: 'list',
      items: state.openQuestions,
    },
  ]
})

const visibleAgentGroups = computed(() => {
  if (vibe.selectedMode === 'claude' || vibe.selectedMode === 'codex' || vibe.selectedMode === 'opencode') {
    const tool = vibe.toolsById.get(vibe.selectedMode)
    return tool ? [tool] : []
  }
  return vibe.tools.filter(tool => tool.agents.length > 0)
})

const agentPanelHint = computed(() => {
  if (vibe.selectedMode === 'auto') {
    return '当前是自动模式，这里会展示全部可用 CLI 工具的 Agent。'
  }
  if (vibe.selectedMode === 'parallel') {
    return '当前是并行模式，这里会展示全部可参与并行处理的 Agent。'
  }
  return `当前锁定 ${selectedModeLabel.value}，这里只展示它自己的 Agent。`
})

const expandedMemorySet = computed(() => new Set(expandedMemoryIds.value))
const expandedAgentGroupSet = computed(() => new Set(expandedAgentGroupIds.value))
const expandedAgentSet = computed(() => new Set(expandedAgentIds.value))

let refreshTimer: ReturnType<typeof setInterval> | null = null

function modeClasses(mode: ToolExecutionMode) {
  const selected = vibe.selectedMode === mode
  return selected
    ? 'border-sky-500/50 bg-sky-500/15 text-sky-100'
    : 'border-gray-800 bg-gray-950/70 text-gray-300 hover:border-gray-700 hover:text-white'
}

function panelTabClasses(panel: HeaderPanelId) {
  const selected = activePanel.value === panel
  return selected
    ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-100'
    : 'border-gray-800 bg-gray-950/70 text-gray-300 hover:border-gray-700 hover:text-white'
}

function stateDotClasses(state: VibeToolState) {
  switch (state) {
    case 'ready':
      return 'bg-emerald-400'
    case 'limited':
      return 'bg-amber-400'
    case 'error':
      return 'bg-rose-400'
    default:
      return 'bg-gray-600'
  }
}

function selectMode(mode: ToolExecutionMode) {
  vibe.setMode(mode)
  ws.setSessionMode(mode)
}

function activatePanel(panel: HeaderPanelId) {
  activePanel.value = panel
  managementPanelOpen.value = true
}

function toggleManagementPanel() {
  managementPanelOpen.value = !managementPanelOpen.value
}

function isMemoryExpanded(id: string) {
  return expandedMemorySet.value.has(id)
}

function toggleMemorySection(id: string) {
  if (expandedMemorySet.value.has(id)) {
    expandedMemoryIds.value = expandedMemoryIds.value.filter(item => item !== id)
    return
  }
  expandedMemoryIds.value = [...expandedMemoryIds.value, id]
}

function isAgentGroupExpanded(id: string) {
  return expandedAgentGroupSet.value.has(id)
}

function toggleAgentGroup(id: string) {
  if (expandedAgentGroupSet.value.has(id)) {
    expandedAgentGroupIds.value = expandedAgentGroupIds.value.filter(item => item !== id)
    return
  }
  expandedAgentGroupIds.value = [...expandedAgentGroupIds.value, id]
}

function isAgentExpanded(id: string) {
  return expandedAgentSet.value.has(id)
}

function toggleAgent(agent: ToolAgentInfo) {
  if (expandedAgentSet.value.has(agent.id)) {
    expandedAgentIds.value = expandedAgentIds.value.filter(item => item !== agent.id)
    return
  }
  expandedAgentIds.value = [...expandedAgentIds.value, agent.id]
}

async function ensurePanelData(panel: HeaderPanelId) {
  if ((panel === 'cli' || panel === 'agents') && !vibe.tools.length && !vibe.loading) {
    await vibe.loadTools()
  }
  if (panel === 'memory' && currentSessionId.value && memory.current?.sessionId !== currentSessionId.value && !memory.loading) {
    await memory.load(currentSessionId.value)
  }
}

async function refreshActivePanel() {
  if (activePanel.value === 'memory') {
    if (!currentSessionId.value) return
    await memory.load(currentSessionId.value)
    return
  }
  await vibe.loadTools()
}

watch(
  () => [managementPanelOpen.value, activePanel.value] as const,
  ([open, panel]) => {
    if (!open) return
    ensurePanelData(panel).catch(() => {})
  },
)

watch(
  () => currentSessionId.value,
  (sessionId, previousSessionId) => {
    if (sessionId === previousSessionId) return
    expandedMemoryIds.value = []
    memory.clear()
    if (managementPanelOpen.value && activePanel.value === 'memory' && sessionId) {
      memory.load(sessionId).catch(() => {})
    }
  },
)

watch(
  () => vibe.selectedMode,
  () => {
    expandedAgentGroupIds.value = []
    expandedAgentIds.value = []
  },
)

onMounted(async () => {
  await vibe.loadTools()
  refreshTimer = setInterval(() => {
    vibe.loadTools().catch(() => {})
  }, 30_000)
})

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<template>
  <header class="shrink-0 border-b border-gray-800 bg-gray-900 px-4 py-3">
    <div class="flex items-start justify-between gap-3">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <button
          class="shrink-0 cursor-pointer text-gray-400 transition-colors hover:text-white"
          @click="router.push('/sessions')"
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div class="min-w-0 flex-1">
          <h2 class="truncate text-sm font-medium text-white" :title="sessionTitle">
            {{ sessionTitle }}
          </h2>

          <div class="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge :status="chat.status" />
            <span
              class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4"
              :class="statusToolOnline
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                : 'border-gray-700 bg-gray-800 text-gray-500'"
            >
              <span class="h-1.5 w-1.5 rounded-full" :class="statusToolOnline ? 'bg-emerald-400' : 'bg-gray-500'" />
              {{ statusToolLabel }} {{ statusToolOnline ? '在线' : '离线' }}
            </span>
          </div>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-2 pl-3">
        <button
          class="cursor-pointer rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          @click="router.push('/files')"
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
        </button>

        <button
          class="cursor-pointer rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          @click="router.push('/settings')"
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    </div>

    <div class="mt-3 rounded-2xl border border-gray-800 bg-gray-950/60">
      <div class="flex items-center gap-2 border-b border-gray-800 px-3 py-3">
        <div class="grid flex-1 grid-cols-3 gap-2">
          <button
            class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors"
            :class="panelTabClasses('cli')"
            @click="activatePanel('cli')"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
            </svg>
            <span class="truncate">CLI</span>
          </button>

          <button
            class="inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors"
            :class="memoryManageDisabled
              ? 'cursor-not-allowed border-gray-800 bg-gray-950/40 text-gray-600'
              : panelTabClasses('memory')"
            :disabled="memoryManageDisabled"
            @click="activatePanel('memory')"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z" />
            </svg>
            <span class="truncate">Memory</span>
          </button>

          <button
            class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors"
            :class="panelTabClasses('agents')"
            @click="activatePanel('agents')"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5V4H2v16h5M12 12a3 3 0 100-6 3 3 0 000 6zm0 0c-3.314 0-6 2.239-6 5v1h12v-1c0-2.761-2.686-5-6-5z" />
            </svg>
            <span class="truncate">Agent</span>
          </button>
        </div>

        <button
          class="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-xs font-medium text-gray-200 transition-colors hover:border-gray-700 hover:bg-gray-800 hover:text-white"
          @click="toggleManagementPanel"
        >
          <svg
            v-if="managementPanelOpen"
            class="h-4 w-4 text-cyan-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
          </svg>
          <svg
            v-else
            class="h-4 w-4 text-cyan-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
          <span>{{ managementPanelOpen ? '收起' : '展开' }}</span>
        </button>
      </div>

      <div v-if="managementPanelOpen" class="px-3 py-3">
        <div v-if="activePanel === 'cli'">
          <div class="flex flex-wrap items-center gap-2">
            <button
              v-for="tab in modeTabs"
              :key="tab.id"
              class="inline-flex min-w-[104px] cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors"
              :class="modeClasses(tab.id)"
              @click="selectMode(tab.id)"
            >
              <span class="truncate font-medium">{{ tab.label }}</span>
              <span class="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-inherit/90">
                <span class="h-1.5 w-1.5 rounded-full" :class="stateDotClasses(tab.state)" />
                {{ tab.statusText }}
              </span>
            </button>
          </div>
        </div>

        <div v-else-if="activePanel === 'memory'" class="flex max-h-[60vh] flex-col gap-3">
          <div class="flex items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900/70 px-4 py-3">
            <p class="text-sm leading-6 text-gray-300">
              当前 session 的 memory 默认分块收起，点开后可以看完整内容。
            </p>
            <button
              class="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/70 px-3 py-2 text-xs text-gray-200 transition-colors hover:border-cyan-500/40 hover:bg-gray-900 hover:text-white"
              @click="refreshActivePanel"
            >
              <svg class="h-4 w-4 text-cyan-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>刷新</span>
            </button>
          </div>

          <div class="min-h-0 overflow-y-auto overscroll-contain pr-1">
          <div
            v-if="memory.loading && !memory.current"
            class="rounded-xl border border-gray-800 bg-gray-900/70 px-4 py-10 text-center text-sm text-gray-500"
          >
            正在加载当前 session 的 memory...
          </div>

          <div
            v-else-if="!memory.current"
            class="rounded-xl border border-gray-800 bg-gray-900/70 px-4 py-10 text-center text-sm text-gray-500"
          >
            当前 session 暂无可展示的 memory。
          </div>

          <template v-else>
            <button
              v-for="section in memorySections"
              :key="section.id"
              type="button"
              class="w-full rounded-xl border border-gray-800 bg-gray-900/70 text-left transition-colors hover:border-gray-700 hover:bg-gray-900"
              @click="toggleMemorySection(section.id)"
            >
              <div class="flex items-center justify-between gap-4 px-4 py-3">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-white">{{ section.title }}</p>
                </div>
                <svg
                  class="mt-0.5 h-4 w-4 shrink-0 text-gray-500 transition-transform"
                  :class="isMemoryExpanded(section.id) ? 'rotate-180' : ''"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              <div v-if="isMemoryExpanded(section.id)" class="border-t border-gray-800 px-4 py-3">
                <p
                  v-if="section.kind === 'text'"
                  class="rounded-lg bg-gray-950/90 px-3 py-2 text-sm leading-6 text-gray-200 break-all whitespace-pre-wrap"
                >
                  {{ section.text }}
                </p>

                <ul v-else class="space-y-2">
                  <li
                    v-for="(item, index) in section.items"
                    :key="`${section.id}-${index}-${item}`"
                    class="rounded-lg bg-gray-950/90 px-3 py-2 text-sm leading-6 text-gray-200 break-all whitespace-pre-wrap"
                    :class="section.id === 'files' ? 'font-mono' : ''"
                  >
                    {{ item }}
                  </li>
                  <li
                    v-if="!section.items?.length"
                    class="rounded-lg bg-gray-950/90 px-3 py-2 text-sm text-gray-500"
                  >
                    暂无内容
                  </li>
                </ul>
              </div>
            </button>
          </template>
          </div>
        </div>

        <div v-else class="space-y-3">
          <div class="flex items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900/70 px-4 py-3">
            <p class="text-sm leading-6 text-gray-300">
              {{ agentPanelHint }}
            </p>
            <button
              class="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/70 px-3 py-2 text-xs text-gray-200 transition-colors hover:border-sky-500/40 hover:bg-gray-900 hover:text-white"
              @click="refreshActivePanel"
            >
              <svg class="h-4 w-4 text-sky-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>刷新</span>
            </button>
          </div>

          <div
            v-if="vibe.loading && !visibleAgentGroups.length"
            class="rounded-xl border border-gray-800 bg-gray-900/70 px-4 py-10 text-center text-sm text-gray-500"
          >
            正在加载 Agent 信息...
          </div>

          <div
            v-else-if="!visibleAgentGroups.length"
            class="rounded-xl border border-gray-800 bg-gray-900/70 px-4 py-10 text-center text-sm text-gray-500"
          >
            当前没有可展示的 Agent。
          </div>

          <template v-else>
            <section
              v-for="tool in visibleAgentGroups"
              :key="tool.id"
              class="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/70"
            >
              <button
                class="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-gray-900"
                @click="toggleAgentGroup(tool.id)"
              >
                <div class="min-w-0">
                  <p class="text-sm font-medium text-white">{{ tool.label }}</p>
                  <p class="mt-1 text-xs text-gray-500">
                    {{ tool.agents.length }} 个 Agent，{{ tool.statusText }}
                  </p>
                </div>
                <svg
                  class="h-4 w-4 shrink-0 text-gray-500 transition-transform"
                  :class="isAgentGroupExpanded(tool.id) ? 'rotate-180' : ''"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <div v-if="isAgentGroupExpanded(tool.id)" class="border-t border-gray-800 px-3 py-3">
                <div class="space-y-2">
                  <button
                    v-for="agent in tool.agents"
                    :key="agent.id"
                    type="button"
                    class="w-full rounded-xl border border-gray-800 bg-gray-950/80 text-left transition-colors hover:border-gray-700 hover:bg-gray-950"
                    @click="toggleAgent(agent)"
                  >
                    <div class="flex items-start justify-between gap-4 px-4 py-3">
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <p class="text-sm font-medium text-white">{{ agent.name }}</p>
                          <span
                            class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]"
                            :class="agent.state === 'ready'
                              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                              : agent.state === 'limited'
                                ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                                : agent.state === 'error'
                                  ? 'border-rose-400/30 bg-rose-400/10 text-rose-300'
                                  : 'border-gray-700 bg-gray-800 text-gray-400'"
                          >
                            {{ agent.statusText }}
                          </span>
                        </div>
                        <p class="mt-1 text-xs leading-5 text-gray-500">
                          {{ agent.capabilities[0] || agent.description || '暂无能力说明' }}
                        </p>
                      </div>
                      <svg
                        class="mt-0.5 h-4 w-4 shrink-0 text-gray-500 transition-transform"
                        :class="isAgentExpanded(agent.id) ? 'rotate-180' : ''"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>

                    <div v-if="isAgentExpanded(agent.id)" class="border-t border-gray-800 px-4 py-3">
                      <p class="text-sm leading-6 text-gray-300">{{ agent.description }}</p>
                      <div class="mt-3 space-y-2">
                        <p class="text-xs font-medium uppercase tracking-[0.2em] text-gray-500">具体能力</p>
                        <ul class="space-y-2">
                          <li
                            v-for="(capability, index) in agent.capabilities"
                            :key="`${agent.id}-capability-${index}`"
                            class="rounded-lg bg-gray-900/80 px-3 py-2 text-sm leading-6 text-gray-200"
                          >
                            {{ capability }}
                          </li>
                          <li
                            v-if="!agent.capabilities.length"
                            class="rounded-lg bg-gray-900/80 px-3 py-2 text-sm text-gray-500"
                          >
                            暂无更详细的能力列表。
                          </li>
                        </ul>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </header>
</template>
