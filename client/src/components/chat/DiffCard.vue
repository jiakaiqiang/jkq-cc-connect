<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ content: string; sourceLabel?: string }>()

const copied = ref(false)

async function copy() {
  await navigator.clipboard.writeText(props.content)
  copied.value = true
  setTimeout(() => copied.value = false, 2000)
}
</script>

<template>
  <div class="mr-auto w-full min-w-0 max-w-[95%]">
    <div v-if="sourceLabel" class="mb-1.5 px-1 text-[11px] font-medium text-gray-500">
      {{ sourceLabel }}
    </div>
    <div class="overflow-hidden rounded-xl border border-gray-700 bg-gray-900">
      <div class="flex min-w-0 items-center justify-between gap-3 px-3 py-1.5 bg-gray-800/50">
        <span class="text-xs text-gray-500">Diff</span>
        <button @click="copy" class="text-xs text-gray-500 hover:text-white transition-colors">
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>
      </div>
      <pre class="max-w-full overflow-x-auto px-3 py-2 text-xs leading-relaxed font-mono text-gray-300 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{{ content }}</pre>
    </div>
  </div>
</template>
