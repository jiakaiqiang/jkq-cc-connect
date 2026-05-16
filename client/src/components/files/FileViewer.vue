<script setup lang="ts">
import { computed } from 'vue'
import type { FileContent } from '@/types'

const props = defineProps<{ file: FileContent }>()

const lines = computed(() => props.file.content.split('\n'))
</script>

<template>
  <div class="flex-1 overflow-auto">
    <div class="px-3 py-2 bg-gray-900 border-b border-gray-800 flex items-center justify-between text-xs text-gray-500">
      <span>{{ file.path }}</span>
      <span>{{ file.language }} · {{ (file.size / 1024).toFixed(1) }} KB</span>
    </div>
    <pre class="p-3 text-xs leading-relaxed text-gray-300 overflow-auto"><code
      ><span
        v-for="(line, i) in lines"
        :key="i"
        class="block"
      ><span class="text-gray-600 w-8 inline-block text-right mr-4 select-none">{{ i + 1 }}</span>{{ line }}</span
    ></code></pre>
  </div>
</template>
