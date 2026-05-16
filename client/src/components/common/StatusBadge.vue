<script setup lang="ts">
import type { CCStatus } from '@/types'
import { computed } from 'vue'

const props = defineProps<{ status: CCStatus }>()

const config = computed(() => {
  switch (props.status) {
    case 'idle': return { label: '就绪', color: 'bg-green-500' }
    case 'thinking': return { label: '思考中', color: 'bg-yellow-500 animate-pulse' }
    case 'executing': return { label: '处理中', color: 'bg-blue-500 animate-pulse' }
    case 'waiting_confirm': return { label: '等待确认', color: 'bg-orange-500' }
    default: return { label: props.status, color: 'bg-gray-500' }
  }
})
</script>

<template>
  <span class="flex items-center gap-1.5 text-xs">
    <span class="w-2 h-2 rounded-full" :class="config.color"></span>
    {{ config.label }}
  </span>
</template>
