<script setup lang="ts">
import { useFileStore } from '@/stores/files'

const store = useFileStore()

async function enter(path: string, type: 'file' | 'directory') {
  if (type === 'directory') {
    await store.loadDirectory(path)
  } else {
    await store.openFile(path)
  }
}
</script>

<template>
  <div class="flex-1 overflow-y-auto overscroll-contain">
    <div v-if="store.loading" class="px-4 py-8 text-center text-gray-500 text-sm">Loading...</div>

    <div v-else-if="store.entries.length === 0" class="px-4 py-8 text-center text-gray-500 text-sm">
      Empty directory
    </div>

    <div v-else class="divide-y divide-gray-800/50">
      <button
        v-for="entry in store.entries"
        :key="entry.path"
        @click="enter(entry.path, entry.type)"
        @touchend.prevent="enter(entry.path, entry.type)"
        class="w-full flex items-center gap-3 px-4 min-h-[48px] active:bg-gray-800/70 hover:bg-gray-800/50 transition-colors text-left"
      >
        <span class="text-xl shrink-0">
          {{ entry.type === 'directory' ? '📁' : '📄' }}
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm text-gray-200 truncate">{{ entry.name }}</p>
          <p v-if="entry.size" class="text-xs text-gray-600">{{ (entry.size / 1024).toFixed(1) }} KB</p>
        </div>
        <svg v-if="entry.type === 'directory'" class="w-5 h-5 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  </div>
</template>
