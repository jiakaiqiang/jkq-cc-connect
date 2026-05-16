<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ content: string; sourceLabel?: string }>()

const expanded = ref(false)
</script>

<template>
  <div class="mr-auto w-full min-w-0 max-w-[90%]">
    <div v-if="sourceLabel" class="mb-1.5 px-1 text-[11px] font-medium text-gray-500">
      {{ sourceLabel }}
    </div>
    <button
      @click="expanded = !expanded"
      class="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-400 px-2 py-1 rounded-lg hover:bg-gray-800/50 transition-colors"
    >
      <svg
        class="w-3.5 h-3.5 transition-transform"
        :class="{ 'rotate-90': expanded }"
        fill="none" viewBox="0 0 24 24" stroke="currentColor"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
      <span>{{ expanded ? 'Hide thinking' : 'Show thinking' }}</span>
    </button>
    <div v-if="expanded" class="mt-1 rounded-xl border border-gray-800 bg-gray-800/50 px-3 py-2 text-xs leading-relaxed text-gray-400 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {{ content }}
    </div>
  </div>
</template>
