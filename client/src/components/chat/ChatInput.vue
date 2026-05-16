<script setup lang="ts">
import { computed, ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useWSStore } from '@/stores/ws'
import { detectModeFromNaturalLanguage, useVibeStore } from '@/stores/vibe'
import type { AgentMention, ToolAgentInfo, VibeToolId } from '@/types'

interface SlashPreset {
  command: string
  hint: string
  template: string
}

interface MentionContext {
  start: number
  end: number
  query: string
}

const chat = useChatStore()
const ws = useWSStore()
const vibe = useVibeStore()
const text = ref('')
const composing = ref(false)
const textarea = ref<HTMLTextAreaElement>()
const cursorPosition = ref(0)
const slashActiveIndex = ref(0)
const mentionActiveIndex = ref(0)

const slashPresets: SlashPreset[] = [
  { command: '/help', hint: '查看可用命令', template: '/help' },
  { command: '/claude', hint: '直接执行 Claude CLI 命令', template: '/claude --help' },
  { command: '/claude mcp', hint: '查看 Claude 的 MCP 命令', template: '/claude mcp list' },
  { command: '/codex', hint: '直接执行 Codex CLI 命令', template: '/codex --help' },
  { command: '/codex exec', hint: '执行 Codex 非交互任务', template: '/codex exec "describe this repo"' },
  { command: '/codex review', hint: '执行 Codex review', template: '/codex review' },
  { command: '/opencode', hint: '直接执行 OpenCode CLI 命令', template: '/opencode --help' },
  { command: '/opencode models', hint: '查看 OpenCode 可用模型', template: '/opencode models' },
  { command: '/opencode providers', hint: '查看 OpenCode providers', template: '/opencode providers list' },
  { command: '/skill', hint: '通过 Claude 调用 skill', template: '/skill ui-ux-pro-max 优化当前页面布局' },
  { command: '/mcp', hint: '指定 MCP 名称处理请求', template: '/mcp context7 查询当前框架文档' },
  { command: '/mode claude', hint: '本次消息使用 Claude', template: '/mode claude 帮我继续实现当前需求' },
  { command: '/mode codex', hint: '本次消息使用 Codex', template: '/mode codex 帮我做一次代码审查' },
  { command: '/mode opencode', hint: '本次消息使用 OpenCode', template: '/mode opencode 帮我列出当前模型' },
]

const canSend = computed(() => text.value.trim().length > 0 && !chat.isProcessing && ws.connected && !!chat.session)

const slashQuery = computed(() => {
  const trimmed = text.value.trimStart()
  if (!trimmed.startsWith('/')) return ''
  return trimmed.toLowerCase()
})

const filteredSlashPresets = computed(() => {
  if (!slashQuery.value) return []
  return slashPresets.filter(item =>
    item.command.startsWith(slashQuery.value) ||
    slashQuery.value.startsWith(item.command) ||
    item.hint.includes(slashQuery.value.slice(1)),
  )
})

const showSlashMenu = computed(() => filteredSlashPresets.value.length > 0 && text.value.trimStart().startsWith('/'))

const mentionToolId = computed<VibeToolId>(() => {
  if (vibe.selectedMode === 'claude' || vibe.selectedMode === 'codex' || vibe.selectedMode === 'opencode') {
    return vibe.selectedMode
  }
  return 'claude'
})

const mentionContext = computed<MentionContext | null>(() => {
  if (showSlashMenu.value) return null

  const beforeCursor = text.value.slice(0, cursorPosition.value)
  const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/)
  if (!match) return null

  const query = match[2] || ''
  const end = beforeCursor.length
  const start = end - query.length - 1

  if (start < 0) return null
  return { start, end, query }
})

const mentionAgents = computed(() => vibe.toolsById.get(mentionToolId.value)?.agents || [])

const filteredMentionAgents = computed(() => {
  const context = mentionContext.value
  if (!context) return []

  const query = context.query.trim().toLowerCase()
  if (!query) return mentionAgents.value

  return mentionAgents.value.filter(agent => {
    const capability = agent.capabilities[0] || agent.description || ''
    return (
      agent.name.toLowerCase().includes(query) ||
      capability.toLowerCase().includes(query) ||
      agent.statusText.toLowerCase().includes(query)
    )
  })
})

const showMentionMenu = computed(() => !!mentionContext.value && filteredMentionAgents.value.length > 0)

function onCompositionStart() {
  composing.value = true
}

function onCompositionEnd(e: Event) {
  composing.value = false
  const target = e.target as HTMLTextAreaElement
  text.value = target.value
  cursorPosition.value = target.selectionStart ?? target.value.length
}

function updateCursorPosition() {
  cursorPosition.value = textarea.value?.selectionStart ?? text.value.length
}

function focusTextareaAt(position: number) {
  requestAnimationFrame(() => {
    textarea.value?.focus()
    textarea.value?.setSelectionRange(position, position)
    cursorPosition.value = position
  })
}

function applySlashPreset(preset: SlashPreset) {
  text.value = preset.template
  slashActiveIndex.value = 0
  mentionActiveIndex.value = 0
  focusTextareaAt(text.value.length)
}

function applyMentionAgent(agent: ToolAgentInfo) {
  const context = mentionContext.value
  if (!context) return

  text.value = `${text.value.slice(0, context.start)}@${agent.name} ${text.value.slice(context.end)}`
  slashActiveIndex.value = 0
  mentionActiveIndex.value = 0
  focusTextareaAt(context.start + agent.name.length + 2)
}

function moveSlashIndex(direction: 1 | -1) {
  if (!showSlashMenu.value) return
  const total = filteredSlashPresets.value.length
  if (!total) return
  slashActiveIndex.value = (slashActiveIndex.value + direction + total) % total
}

function moveMentionIndex(direction: 1 | -1) {
  if (!showMentionMenu.value) return
  const total = filteredMentionAgents.value.length
  if (!total) return
  mentionActiveIndex.value = (mentionActiveIndex.value + direction + total) % total
}

function onKeydown(e: KeyboardEvent) {
  if (showMentionMenu.value && e.key === 'ArrowDown') {
    e.preventDefault()
    moveMentionIndex(1)
    return
  }

  if (showMentionMenu.value && e.key === 'ArrowUp') {
    e.preventDefault()
    moveMentionIndex(-1)
    return
  }

  if (showMentionMenu.value && (e.key === 'Tab' || e.key === 'Enter') && !composing.value && !e.shiftKey) {
    e.preventDefault()
    applyMentionAgent(filteredMentionAgents.value[mentionActiveIndex.value] || filteredMentionAgents.value[0])
    return
  }

  if (showMentionMenu.value && e.key === 'Escape') {
    e.preventDefault()
    mentionActiveIndex.value = 0
    return
  }

  if (showSlashMenu.value && e.key === 'ArrowDown') {
    e.preventDefault()
    moveSlashIndex(1)
    return
  }

  if (showSlashMenu.value && e.key === 'ArrowUp') {
    e.preventDefault()
    moveSlashIndex(-1)
    return
  }

  if (showSlashMenu.value && (e.key === 'Tab' || e.key === 'Enter') && !composing.value && !e.shiftKey) {
    e.preventDefault()
    applySlashPreset(filteredSlashPresets.value[slashActiveIndex.value] || filteredSlashPresets.value[0])
    return
  }

  if (e.key === 'Enter' && !composing.value && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function onInput(e: Event) {
  const target = e.target as HTMLTextAreaElement
  cursorPosition.value = target.selectionStart ?? target.value.length
  slashActiveIndex.value = 0
  mentionActiveIndex.value = 0
}

function parseMentionsFromText(input: string): AgentMention[] {
  const agentsByName = new Map(mentionAgents.value.map(agent => [agent.name.toLowerCase(), agent]))
  const mentions: AgentMention[] = []
  const seen = new Set<string>()
  const regex = /(^|\s)@([^\s@]+)/g
  let match: RegExpExecArray | null = regex.exec(input)

  while (match) {
    const name = match[2].trim().toLowerCase()
    const agent = agentsByName.get(name)
    if (agent && !seen.has(agent.id)) {
      seen.add(agent.id)
      mentions.push({
        toolId: mentionToolId.value,
        agentId: agent.id,
        name: agent.name,
        order: mentions.length,
      })
    }
    match = regex.exec(input)
  }

  return mentions
}

function send() {
  const trimmed = text.value.trim()
  if (!trimmed || chat.isProcessing) return
  if (!ws.connected) {
    chat.addMessage({
      type: 'error',
      message: 'Not connected to server. Please refresh the page.',
    } as any)
    return
  }
  if (!chat.session) {
    chat.addMessage({
      type: 'error',
      message: 'No active session. Please select or create a session.',
    } as any)
    return
  }

  const mentions = parseMentionsFromText(trimmed)
  const inferredMode = mentions.length ? null : detectModeFromNaturalLanguage(trimmed)
  const effectiveMode = mentions.length ? mentionToolId.value : (inferredMode || vibe.selectedMode)

  if (inferredMode && inferredMode !== vibe.selectedMode) {
    vibe.setMode(inferredMode)
  }

  chat.sendInput(trimmed, effectiveMode, mentions)
  text.value = ''
  slashActiveIndex.value = 0
  mentionActiveIndex.value = 0
  cursorPosition.value = 0
}
</script>

<template>
  <div class="shrink-0 border-t border-gray-800 bg-gray-900 px-3 py-2">
    <div class="relative">
      <div
        v-if="showMentionMenu"
        class="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-gray-800 bg-gray-950/95 shadow-2xl"
      >
        <div class="max-h-64 overflow-y-auto overscroll-contain">
          <button
            v-for="(agent, index) in filteredMentionAgents"
            :key="agent.id"
            type="button"
            class="w-full cursor-pointer border-b border-gray-800 px-3 py-2 text-left transition-colors last:border-b-0"
            :class="index === mentionActiveIndex ? 'bg-gray-900' : 'hover:bg-gray-900/80'"
            @mousedown.prevent="applyMentionAgent(agent)"
            @mouseenter="mentionActiveIndex = index"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="truncate text-sm font-medium text-gray-200">@{{ agent.name }}</span>
              <span class="shrink-0 text-[11px] text-gray-500">{{ agent.statusText }}</span>
            </div>
            <p class="mt-1 truncate text-[11px] text-gray-500">
              {{ agent.capabilities[0] || agent.description || '暂无能力说明' }}
            </p>
          </button>
        </div>
      </div>

      <div
        v-else-if="showSlashMenu"
        class="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-gray-800 bg-gray-950/95 shadow-2xl"
      >
        <div class="max-h-64 overflow-y-auto overscroll-contain">
          <button
            v-for="(preset, index) in filteredSlashPresets"
            :key="`${preset.command}-${index}`"
            type="button"
            class="w-full cursor-pointer border-b border-gray-800 px-3 py-2 text-left transition-colors last:border-b-0"
            :class="index === slashActiveIndex ? 'bg-gray-900' : 'hover:bg-gray-900/80'"
            @mousedown.prevent="applySlashPreset(preset)"
            @mouseenter="slashActiveIndex = index"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-medium text-gray-200">{{ preset.command }}</span>
              <span class="truncate text-[11px] text-gray-500">{{ preset.hint }}</span>
            </div>
          </button>
        </div>
      </div>

      <div class="flex items-end gap-2">
        <textarea
          ref="textarea"
          v-model="text"
          rows="1"
          class="max-h-24 flex-1 resize-none rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          :disabled="chat.isProcessing"
          placeholder="输入消息，或输入 @ 选择 agent、输入 / 使用命令..."
          @click="updateCursorPosition"
          @input="onInput"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @keydown="onKeydown"
          @keyup="updateCursorPosition"
        />
        <button
          class="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl bg-indigo-600 p-2.5 text-white transition-colors hover:bg-indigo-500 active:bg-indigo-400 disabled:opacity-40"
          :disabled="!canSend"
          @click="send"
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
