<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useChatStore, type UIMessage } from '@/stores/chat'
import { api } from '@/utils/api'
import MessageBubble from './MessageBubble.vue'
import ThinkingBubble from './ThinkingBubble.vue'
import CodeBlockCard from './CodeBlockCard.vue'
import DiffCard from './DiffCard.vue'
import ToolUseCard from './ToolUseCard.vue'
import ToolResultCard from './ToolResultCard.vue'
import ConfirmCard from './ConfirmCard.vue'
import { getMessageBubbleSourceProps } from './sourceLabel'

const chat = useChatStore()
const container = ref<HTMLElement>()
const olderLoading = computed(() => chat.loadingOlderHistory)
const activeConfirm = computed(() => {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index]
    if (message.type === 'confirm_request') return message
  }
  return null
})
const activeToolStatus = computed(() => {
  if (chat.status !== 'executing' || !chat.activeToolUse) return null
  const lastVisibleMessage = [...chat.messages].reverse().find(message => message.type !== 'confirm_request')
  if (lastVisibleMessage?.type === 'tool_use') return null
  return chat.activeToolUse
})

watch(
  () => [chat.messages.length, chat.messages[chat.messages.length - 1]?.content, chat.status, chat.lastMutation],
  async () => {
    await nextTick()
    if (container.value && chat.lastMutation !== 'prepend') {
      container.value.scrollTop = container.value.scrollHeight
    }
  },
)

async function loadOlderMessages() {
  if (!chat.session || !chat.hasMoreHistory || chat.oldestSeq == null || olderLoading.value) return

  const previousHeight = container.value?.scrollHeight ?? 0
  chat.setLoadingOlderHistory(true)
  try {
    const page = await api.getSessionMessages(chat.session.id, chat.oldestSeq, 40)
    chat.prependMessages(page.messages, { hasMore: page.hasMore, oldestSeq: page.oldestSeq })
    await nextTick()
    if (container.value) {
      container.value.scrollTop = container.value.scrollHeight - previousHeight
    }
  } finally {
    chat.setLoadingOlderHistory(false)
  }
}

function getMessageComponent(msg: UIMessage) {
  switch (msg.type) {
    case 'user':
      return { comp: MessageBubble, props: { content: msg.content, role: 'user' as const } }
    case 'text':
      return {
        comp: MessageBubble,
        props: {
          content: msg.content,
          role: 'assistant' as const,
          ...getMessageBubbleSourceProps(msg.metadata),
        },
      }
    case 'thinking':
      return {
        comp: ThinkingBubble,
        props: {
          content: msg.content,
          sourceLabel: msg.metadata.sourceLabel as string | undefined,
        },
      }
    case 'code':
      return {
        comp: CodeBlockCard,
        props: {
          content: msg.content,
          language: (msg.metadata.language as string) || '',
          sourceLabel: msg.metadata.sourceLabel as string | undefined,
        },
      }
    case 'diff':
      return { comp: DiffCard, props: { content: msg.content, sourceLabel: msg.metadata.sourceLabel as string | undefined } }
    case 'tool_use':
      return {
        comp: ToolUseCard,
        props: {
          toolName: msg.metadata.toolName as string,
          toolInput: (msg.metadata.toolInput as Record<string, unknown>) || {},
          sourceLabel: msg.metadata.sourceLabel as string | undefined,
        },
      }
    case 'tool_result':
      return {
        comp: ToolResultCard,
        props: {
          content: msg.content,
          sourceLabel: msg.metadata.sourceLabel as string | undefined,
        },
      }
    case 'confirm_request':
      return null
    case 'error':
      return {
        comp: MessageBubble,
        props: {
          content: `[错误] ${msg.content}`,
          role: 'assistant' as const,
          ...getMessageBubbleSourceProps(msg.metadata),
        },
      }
    default:
      return null
  }
}
</script>

<template>
  <div ref="container" class="flex-1 overflow-y-auto px-3 py-4 space-y-3">
    <div v-if="chat.hasMoreHistory" class="flex justify-center">
      <button
        type="button"
        class="rounded-md border border-gray-800 bg-gray-900 px-3 py-1.5 text-xs text-gray-300 transition hover:border-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="olderLoading"
        @click="loadOlderMessages"
      >
        {{ olderLoading ? '加载中...' : '加载更早消息' }}
      </button>
    </div>

    <template v-for="msg in chat.messages" :key="msg.id">
      <component
        v-if="getMessageComponent(msg)"
        :is="getMessageComponent(msg)!.comp"
        v-bind="getMessageComponent(msg)!.props"
      />
    </template>

    <div
      v-if="chat.processingHintVisible && chat.processingStatusText"
      class="mr-auto flex max-w-[90%] items-center gap-2 rounded-xl border border-gray-800 bg-gray-800/35 px-3 py-2 text-xs text-gray-400"
      aria-live="polite"
    >
      <span class="flex items-center gap-1.5">
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" />
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-500 [animation-delay:120ms]" />
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-600 [animation-delay:240ms]" />
      </span>
      <span>{{ chat.processingStatusText }}</span>
    </div>

    <ToolUseCard
      v-if="activeToolStatus"
      :tool-name="activeToolStatus.toolName"
      :tool-input="activeToolStatus.toolInput"
      :source-label="activeToolStatus.sourceLabel"
    />

    <div
      v-if="activeConfirm"
      class="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4"
    >
      <div class="pointer-events-auto w-full max-w-sm">
        <ConfirmCard
          :request-id="activeConfirm.metadata.requestId as string"
          :message="activeConfirm.content"
          :tool-name="(activeConfirm.metadata.toolName as string) || '当前工具'"
        />
      </div>
    </div>
  </div>
</template>
