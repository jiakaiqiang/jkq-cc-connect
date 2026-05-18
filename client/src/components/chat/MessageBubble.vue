<script setup lang="ts">
import { computed } from 'vue'
import type { OrchestrationStep } from '@/types'
import { renderMarkdown } from '@/utils/markdown'
import { resolveMessageSourceLabel } from './sourceLabel'

const props = defineProps<{
  content: string
  role: 'user' | 'assistant'
  sourceLabel?: string
  senderAgentName?: string
  targetAgentName?: string
  orchestrationStep?: OrchestrationStep
}>()

const html = computed(() => renderMarkdown(props.content))
const resolvedSourceLabel = computed(() => resolveMessageSourceLabel({
  sourceLabel: props.sourceLabel,
  senderAgentName: props.senderAgentName,
  targetAgentName: props.targetAgentName,
  orchestrationStep: props.orchestrationStep,
}))
</script>

<template>
  <div :class="['w-full min-w-0 max-w-[85%]', role === 'user' ? 'ml-auto' : 'mr-auto']">
    <div
      v-if="role === 'assistant' && resolvedSourceLabel"
      class="mb-1.5 px-1 text-[11px] font-medium text-gray-500"
    >
      {{ resolvedSourceLabel }}
    </div>
    <div :class="[
      'min-w-0 overflow-hidden rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
      role === 'user'
        ? 'bg-indigo-600 text-white rounded-br-md'
        : 'bg-gray-800 text-gray-200 rounded-bl-md'
    ]">
      <div
        v-if="role === 'assistant'"
        class="chat-markdown prose prose-invert prose-sm max-w-none break-words [overflow-wrap:anywhere]"
        v-html="html"
      />
      <div v-else class="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{{ content }}</div>
    </div>
  </div>
</template>

<style scoped>
.chat-markdown:deep(p),
.chat-markdown:deep(li),
.chat-markdown:deep(blockquote),
.chat-markdown:deep(td),
.chat-markdown:deep(th) {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.chat-markdown:deep(a) {
  overflow-wrap: anywhere;
  word-break: break-all;
}

.chat-markdown:deep(pre) {
  max-width: 100%;
  overflow-x: auto;
}

.chat-markdown:deep(code) {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.chat-markdown:deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
}
</style>
