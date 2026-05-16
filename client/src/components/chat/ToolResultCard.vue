<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  content: string
  sourceLabel?: string
}>()

const copied = ref(false)

const displayContent = computed(() => {
  const text = props.content?.trim()
  return text || '工具已返回结果'
})

async function copy() {
  await navigator.clipboard.writeText(displayContent.value)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}
</script>

<template>
  <div class="mr-auto w-full min-w-0 max-w-[92%]">
    <div v-if="sourceLabel" class="mb-1.5 px-1 text-[11px] font-medium text-gray-500">
      {{ sourceLabel }}
    </div>
    <div class="overflow-hidden rounded-xl border border-gray-700/60 bg-gray-900/80">
      <div class="flex min-w-0 items-center justify-between gap-3 border-b border-gray-800 bg-gray-800/50 px-3 py-2">
        <span class="text-xs font-medium text-gray-400">工具结果</span>
        <button @click="copy" class="text-xs text-gray-500 transition-colors hover:text-white">
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>
      </div>
      <div class="px-3 py-2 text-xs leading-relaxed text-gray-300 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {{ displayContent }}
      </div>
    </div>
  </div>
</template>
