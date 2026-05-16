<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMemoryStore } from '@/stores/memory'
import { api } from '@/utils/api'
import { formatSessionDisplayName } from '@/utils/date'
import type { SessionInfo } from '@/types'

type MemorySection = {
  id: string
  title: string
  preview: string
  kind: 'text' | 'list'
  items?: string[]
  text?: string
}

const route = useRoute()
const router = useRouter()
const memory = useMemoryStore()
const session = ref<SessionInfo | null>(null)
const expandedIds = ref<string[]>([])

const sessionId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')

const pageTitle = computed(() => {
  return session.value
    ? formatSessionDisplayName(session.value.name, session.value.lastActive)
    : 'Memory 管理'
})

const sections = computed<MemorySection[]>(() => {
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

const expandedSet = computed(() => new Set(expandedIds.value))

function isExpanded(id: string) {
  return expandedSet.value.has(id)
}

function toggleSection(id: string) {
  if (expandedSet.value.has(id)) {
    expandedIds.value = expandedIds.value.filter(item => item !== id)
    return
  }
  expandedIds.value = [...expandedIds.value, id]
}

async function loadMemoryState() {
  if (!sessionId.value) return
  const [sessionData] = await Promise.all([
    api.getSession(sessionId.value),
    memory.load(sessionId.value),
  ])
  session.value = sessionData.session
}

onMounted(() => {
  loadMemoryState().catch(() => {})
})
</script>

<template>
  <div class="flex h-full flex-col bg-gray-950 text-gray-100">
    <header class="shrink-0 border-b border-gray-800 bg-gray-900/95 px-4 py-3">
      <div class="mx-auto flex max-w-5xl items-start gap-3">
        <button
          class="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          @click="router.push(`/chat/${sessionId}`)"
          aria-label="返回聊天"
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div class="min-w-0 flex-1">
          <h1 class="truncate text-lg font-semibold text-white">{{ pageTitle }}</h1>
          <p class="mt-0.5 text-xs leading-5 text-gray-400">
            分层记忆默认收起，点击任意模块可展开查看完整内容。
          </p>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <button
            class="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-200 transition-colors hover:border-cyan-500/40 hover:bg-gray-900 hover:text-white"
            @click="loadMemoryState"
          >
            刷新
          </button>
        </div>
      </div>
    </header>

    <main class="flex-1 overflow-y-auto px-4 py-4">
      <div class="mx-auto max-w-5xl space-y-3">
        <div
          v-if="memory.loading && !memory.current"
          class="rounded-lg border border-gray-800 bg-gray-900/70 px-4 py-10 text-center text-sm text-gray-500"
        >
          加载中...
        </div>

        <div
          v-else-if="!memory.current"
          class="rounded-lg border border-gray-800 bg-gray-900/70 px-4 py-10 text-center text-sm text-gray-500"
        >
          当前 session 暂无可展示的 memory。
        </div>

        <template v-else>
          <button
            v-for="section in sections"
            :key="section.id"
            type="button"
            class="w-full rounded-lg border border-gray-800 bg-gray-900/70 text-left transition-colors hover:border-gray-700 hover:bg-gray-900"
            @click="toggleSection(section.id)"
          >
            <div class="flex items-center justify-between gap-4 px-4 py-3">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-white">{{ section.title }}</p>
              </div>
              <svg
                class="mt-0.5 h-4 w-4 shrink-0 text-gray-500 transition-transform"
                :class="isExpanded(section.id) ? 'rotate-180' : ''"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </div>

            <div v-if="isExpanded(section.id)" class="border-t border-gray-800 px-4 py-3">
              <p
                v-if="section.kind === 'text'"
                class="rounded-md bg-gray-950/90 px-3 py-2 text-sm leading-6 text-gray-200 break-all whitespace-pre-wrap"
              >
                {{ section.text }}
              </p>

              <ul v-else class="space-y-2">
                <li
                  v-for="(item, index) in section.items"
                  :key="`${section.id}-${index}-${item}`"
                  class="rounded-md bg-gray-950/90 px-3 py-2 text-sm leading-6 text-gray-200 break-all whitespace-pre-wrap"
                  :class="section.id === 'files' ? 'font-mono' : ''"
                >
                  {{ item }}
                </li>
                <li
                  v-if="!section.items?.length"
                  class="rounded-md bg-gray-950/90 px-3 py-2 text-sm text-gray-500"
                >
                  暂无
                </li>
              </ul>
            </div>
          </button>
        </template>
      </div>
    </main>
  </div>
</template>
