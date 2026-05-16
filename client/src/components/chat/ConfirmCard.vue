<script setup lang="ts">
import { useChatStore } from '@/stores/chat'

const props = defineProps<{
  requestId: string
  message: string
  toolName: string
}>()

const chat = useChatStore()
</script>

<template>
  <div class="mr-auto overflow-hidden rounded-xl border border-orange-700/50 bg-[#1f2329] shadow-[0_16px_48px_rgba(0,0,0,0.32)]">
    <div class="px-4 py-3 text-sm text-orange-200">
      <span class="font-medium">{{ toolName || '当前工具' }} 需要确认</span>
      <p class="mt-2 text-sm leading-6 text-gray-300">{{ message }}</p>
    </div>
    <div class="flex border-t border-orange-700/30 bg-[#14171c]">
      <button
        @click="chat.confirmRequest(requestId, true)"
        class="flex-1 py-3 text-sm font-medium text-green-300 transition-colors hover:bg-green-900/20"
      >
        确认
      </button>
      <button
        @click="chat.confirmRequest(requestId, false)"
        class="flex-1 border-l border-orange-700/30 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/20"
      >
        取消
      </button>
    </div>
  </div>
</template>
