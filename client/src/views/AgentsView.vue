<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useVibeStore } from '@/stores/vibe'
import { renderMarkdown } from '@/utils/markdown'
import type { ToolAgentInfo, VibeToolInfo } from '@/types'

const router = useRouter()
const vibe = useVibeStore()

const selectedAgentId = ref<string | null>(null)
const expandedGroupIds = ref<VibeToolInfo['id'][]>([])
const detailDialogOpen = ref(false)

const visibleGroups = computed<VibeToolInfo[]>(() => {
  if (vibe.selectedMode === 'claude' || vibe.selectedMode === 'codex' || vibe.selectedMode === 'opencode') {
    const tool = vibe.toolsById.get(vibe.selectedMode)
    return tool ? [tool] : []
  }
  return vibe.tools
})

const expandedGroupSet = computed(() => new Set(expandedGroupIds.value))

const allFlatAgents = computed(() => {
  return visibleGroups.value.flatMap(tool => tool.agents.map(agent => ({ tool, agent })))
})

const selectedAgentEntry = computed(() => {
  const current = allFlatAgents.value.find(item => item.agent.id === selectedAgentId.value)
  return current || allFlatAgents.value[0] || null
})

const selectedAgentMarkdownHtml = computed(() => {
  const markdown = selectedAgentEntry.value?.agent.markdownContent || ''
  return markdown ? renderMarkdown(markdown) : ''
})

const pageTitle = computed(() => {
  if (vibe.selectedMode === 'auto') return '智能路由 Agent'
  if (vibe.selectedMode === 'parallel') return '并行模式 Agent'
  return `${visibleGroups.value[0]?.label || 'Agent'} 管理`
})

const pageDescription = computed(() => {
  if (vibe.selectedMode === 'auto') {
    return '当前是智能路由模式，下面展示全部 CLI 工具的 Agent，并按工具名称分组。'
  }
  if (vibe.selectedMode === 'parallel') {
    return '当前是并行模式，下面展示全部 CLI 工具的 Agent，并按工具名称分组。'
  }
  return `当前只展示 ${visibleGroups.value[0]?.label || '当前工具'} 对应的 Agent 列表。`
})

watch(visibleGroups, (groups) => {
  const nextIds = groups.map(group => group.id)
  const available = new Set(nextIds)
  expandedGroupIds.value = expandedGroupIds.value.filter(id => available.has(id))
}, { immediate: true })

watch(allFlatAgents, (agents) => {
  if (!agents.length) {
    selectedAgentId.value = null
    detailDialogOpen.value = false
    return
  }
  if (!selectedAgentId.value || !agents.some(item => item.agent.id === selectedAgentId.value)) {
    selectedAgentId.value = agents[0].agent.id
  }
}, { immediate: true })

onMounted(async () => {
  if (!vibe.tools.length) {
    await vibe.loadTools()
  }
})

function selectAgent(agent: ToolAgentInfo) {
  selectedAgentId.value = agent.id
  detailDialogOpen.value = true
}

function closeDetailDialog() {
  detailDialogOpen.value = false
}

function toggleGroup(toolId: VibeToolInfo['id']) {
  if (expandedGroupSet.value.has(toolId)) {
    expandedGroupIds.value = expandedGroupIds.value.filter(id => id !== toolId)
    return
  }
  expandedGroupIds.value = [...expandedGroupIds.value, toolId]
}

function isExpanded(toolId: VibeToolInfo['id']) {
  return expandedGroupSet.value.has(toolId)
}

function stateDotClasses(state: VibeToolInfo['state']) {
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

function badgeClasses(state: VibeToolInfo['state']) {
  switch (state) {
    case 'ready':
      return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
    case 'limited':
      return 'border-amber-400/30 bg-amber-400/10 text-amber-300'
    case 'error':
      return 'border-rose-400/30 bg-rose-400/10 text-rose-300'
    default:
      return 'border-gray-700 bg-gray-800 text-gray-500'
  }
}
</script>

<template>
  <div class="flex h-full flex-col bg-gray-950 text-gray-100">
    <header class="shrink-0 border-b border-gray-800 bg-gray-900/95 px-4 py-2.5">
      <div class="mx-auto flex max-w-7xl items-start gap-3">
        <button
          class="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          @click="router.push('/chat')"
          aria-label="返回聊天"
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div class="min-w-0 flex-1">
          <h1 class="text-lg font-semibold text-white">{{ pageTitle }}</h1>
          <p class="mt-0.5 text-xs leading-5 text-gray-400">{{ pageDescription }}</p>
        </div>
      </div>
    </header>

    <main class="min-h-0 flex-1 overflow-hidden px-4 py-3">
      <div class="mx-auto h-full max-w-7xl">
        <section class="h-full min-h-0 overflow-hidden rounded-lg border border-gray-800 bg-gray-900/70">
          <div class="border-b border-gray-800 px-4 py-2.5">
            <p class="text-sm font-medium text-white">Agent 列表</p>
            <p class="mt-1 text-xs text-gray-500">{{ allFlatAgents.length }} 个 Agent</p>
          </div>

          <div class="h-[calc(100%-61px)] overflow-y-auto px-2.5 py-2.5">
            <div
              v-if="!visibleGroups.length"
              class="rounded-lg border border-dashed border-gray-800 px-4 py-8 text-center text-sm text-gray-500"
            >
              暂未检测到可展示的 Agent。
            </div>

            <div v-else class="space-y-3">
              <section v-for="tool in visibleGroups" :key="tool.id" class="space-y-1.5">
                <button
                  class="sticky top-0 z-10 w-full cursor-pointer rounded-lg border border-gray-800 bg-gray-950/95 px-3 py-2 text-left backdrop-blur transition-colors hover:border-gray-700 hover:bg-gray-900"
                  @click="toggleGroup(tool.id)"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="flex min-w-0 items-center gap-3">
                      <span class="text-gray-500 transition-transform" :class="isExpanded(tool.id) ? 'rotate-90' : ''">
                        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                      </span>
                      <div class="min-w-0">
                        <p class="truncate text-sm font-semibold text-white">{{ tool.label }}</p>
                        <p class="mt-0.5 text-[11px] text-gray-500">
                          {{ tool.agentCount }} 个 Agent · {{ isExpanded(tool.id) ? '已展开' : '已收起' }}
                        </p>
                      </div>
                    </div>
                    <span
                      class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]"
                      :class="badgeClasses(tool.state)"
                    >
                      <span class="h-1.5 w-1.5 rounded-full" :class="stateDotClasses(tool.state)" />
                      {{ tool.statusText }}
                    </span>
                  </div>
                </button>

                <div v-if="isExpanded(tool.id)" class="space-y-1.5">
                  <button
                    v-for="agent in tool.agents"
                    :key="agent.id"
                    class="w-full cursor-pointer rounded-lg border px-3 py-2.5 text-left transition-colors"
                    :class="selectedAgentEntry?.agent.id === agent.id
                      ? 'border-sky-500/40 bg-sky-500/10'
                      : 'border-gray-800 bg-gray-900 hover:border-gray-700 hover:bg-gray-800/80'"
                    @click="selectAgent(agent)"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <p class="truncate text-sm font-medium text-white">{{ agent.name }}</p>
                        <p class="mt-0.5 line-clamp-2 text-[11px] leading-[1.15rem] text-gray-400">{{ agent.description }}</p>
                      </div>
                      <span
                        class="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]"
                        :class="badgeClasses(agent.state)"
                      >
                        <span class="h-1.5 w-1.5 rounded-full" :class="stateDotClasses(agent.state)" />
                        {{ agent.statusText }}
                      </span>
                    </div>
                  </button>
                </div>
              </section>
            </div>
          </div>
        </section>
      </div>
    </main>

    <div
      v-if="detailDialogOpen && selectedAgentEntry"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      @click.self="closeDetailDialog"
    >
      <div class="flex h-[min(82vh,820px)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-950 shadow-2xl">
        <div class="border-b border-gray-800 px-4 py-3">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="text-sm font-medium text-gray-500">{{ selectedAgentEntry.tool.label }}</p>
              <h2 class="mt-1 text-xl font-semibold text-sky-100">{{ selectedAgentEntry.agent.name }}</h2>
              <p class="mt-2 line-clamp-3 text-sm leading-6 text-gray-300">{{ selectedAgentEntry.agent.description }}</p>
            </div>

            <div class="flex shrink-0 items-center gap-3">
              <span
                class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
                :class="badgeClasses(selectedAgentEntry.agent.state)"
              >
                <span class="h-1.5 w-1.5 rounded-full" :class="stateDotClasses(selectedAgentEntry.agent.state)" />
                {{ selectedAgentEntry.agent.statusText }}
              </span>
              <button
                class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
                @click="closeDetailDialog"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div class="grid min-h-0 flex-1 gap-0 xl:grid-cols-[260px_minmax(0,1fr)]">
          <div class="min-h-0 overflow-y-auto border-b border-gray-800 px-4 py-3 xl:border-b-0 xl:border-r">
            <p class="text-sm font-semibold text-sky-100">能力</p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="capability in selectedAgentEntry.agent.capabilities"
                :key="capability"
                class="rounded-full border border-gray-800 bg-gray-950 px-2.5 py-1 text-xs text-gray-200"
              >
                {{ capability }}
              </span>
            </div>
            <p v-if="selectedAgentEntry.agent.markdownPath" class="mt-4 text-xs text-gray-500">
              {{ selectedAgentEntry.agent.markdownPath }}
            </p>
          </div>

          <div class="min-h-0 overflow-y-auto px-4 py-3 pb-8">
            <div
              class="agent-markdown prose prose-invert max-w-none text-sm leading-6 text-gray-200"
              v-html="selectedAgentMarkdownHtml"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-markdown:deep(pre) {
  overflow-x: auto;
  border-radius: 0.5rem;
}

.agent-markdown:deep(code) {
  overflow-wrap: anywhere;
  font-size: inherit;
}

.agent-markdown:deep(a) {
  overflow-wrap: anywhere;
  word-break: break-all;
  color: rgb(125 211 252);
}

.agent-markdown:deep(h1) {
  font-size: inherit;
  line-height: 1.6;
  font-weight: 600;
  color: rgb(224 242 254);
}

.agent-markdown:deep(h2) {
  font-size: inherit;
  line-height: 1.6;
  font-weight: 600;
  color: rgb(191 219 254);
}

.agent-markdown:deep(h3) {
  font-size: inherit;
  line-height: 1.6;
  font-weight: 600;
  color: rgb(147 197 253);
}

.agent-markdown:deep(p),
.agent-markdown:deep(li),
.agent-markdown:deep(blockquote),
.agent-markdown:deep(td),
.agent-markdown:deep(th) {
  font-size: inherit;
  line-height: 1.6;
  color: rgb(209 213 219);
}

.agent-markdown:deep(> :last-child) {
  margin-bottom: 0;
}
</style>
