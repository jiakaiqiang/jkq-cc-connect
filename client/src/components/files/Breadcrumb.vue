<script setup lang="ts">
import { computed } from 'vue'
import { useFileStore } from '@/stores/files'

const store = useFileStore()

const parts = computed(() => {
  const p = store.currentPath
  const rootName = store.currentRoot?.name || 'root'
  if (p === '.') return [{ name: rootName, path: '.' }]
  const segments = p.split('/').filter(Boolean)
  return [
    { name: rootName, path: '.' },
    ...segments.map((seg, i) => ({
      name: seg,
      path: segments.slice(0, i + 1).join('/'),
    })),
  ]
})
</script>

<template>
  <div class="flex items-center gap-1 px-4 py-2 overflow-x-auto text-xs text-gray-500">
    <template v-for="(part, i) in parts" :key="part.path">
      <span v-if="i > 0" class="text-gray-700">/</span>
      <button
        @click="store.loadDirectory(part.path)"
        class="hover:text-gray-300 transition-colors whitespace-nowrap"
        :class="{ 'text-gray-300': i === parts.length - 1 }"
      >
        {{ part.name }}
      </button>
    </template>
  </div>
</template>
