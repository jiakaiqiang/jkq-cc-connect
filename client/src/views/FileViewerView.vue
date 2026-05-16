<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFileStore } from '@/stores/files'
import FileViewer from '@/components/files/FileViewer.vue'

const route = useRoute()
const router = useRouter()
const store = useFileStore()

onMounted(async () => {
  const path = route.query.path as string
  if (path) {
    await store.openFile(path)
  }
})
</script>

<template>
  <div class="flex flex-col h-full">
    <header class="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
      <button @click="router.push('/files')" class="text-gray-400 hover:text-white">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h2 class="text-sm font-medium text-white truncate">View File</h2>
    </header>

    <div v-if="store.loading" class="flex-1 flex items-center justify-center">
      <p class="text-gray-500 text-sm">Loading...</p>
    </div>
    <FileViewer v-else-if="store.selectedFile" :file="store.selectedFile" />
    <div v-else class="flex-1 flex items-center justify-center">
      <p class="text-gray-500 text-sm">File not found</p>
    </div>
  </div>
</template>
