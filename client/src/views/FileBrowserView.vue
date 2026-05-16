<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useFileStore } from '@/stores/files'
import { useVibeStore } from '@/stores/vibe'
import { api } from '@/utils/api'
import Breadcrumb from '@/components/files/Breadcrumb.vue'
import FileTree from '@/components/files/FileTree.vue'
import FileViewer from '@/components/files/FileViewer.vue'

const router = useRouter()
const store = useFileStore()
const vibe = useVibeStore()

onMounted(async () => {
  await store.loadRoots()
  if (store.currentRootId) {
    await store.loadDirectory(store.currentPath)
  }
})

async function createSessionFromCurrentDirectory() {
  if (!store.selectedProjectDir) return
  const session = await api.createSession(store.selectedProjectDir)
  vibe.setMode('claude')
  router.push(`/chat/${session.id}`)
}
</script>

<template>
  <div class="flex flex-col h-full">
    <header class="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
      <button @click="router.push('/chat')" class="text-gray-400 hover:text-white">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h2 class="text-sm font-medium text-white">Files</h2>
    </header>

    <div class="px-4 py-3 border-b border-gray-800 bg-gray-950">
      <label class="block text-xs text-gray-500 mb-2">Allowed roots</label>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="root in store.roots"
          :key="root.id"
          @click="store.selectRoot(root.id)"
          class="px-3 py-1.5 rounded-full text-xs transition-colors"
          :class="store.currentRootId === root.id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'"
        >
          {{ root.name }}
        </button>
      </div>
    </div>

    <Breadcrumb />

    <template v-if="store.selectedFile">
      <FileViewer :file="store.selectedFile" />
      <div class="px-4 py-2 bg-gray-900 border-t border-gray-800 shrink-0">
        <button
          @click="store.closeFile()"
          class="w-full py-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          Close File
        </button>
      </div>
    </template>

    <FileTree v-else />

    <div class="px-4 py-3 bg-gray-900 border-t border-gray-800 shrink-0">
      <button
        @click="createSessionFromCurrentDirectory"
        :disabled="!store.selectedProjectDir"
        class="w-full py-3 rounded-lg text-sm font-medium transition-colors bg-blue-600 text-white disabled:bg-gray-800 disabled:text-gray-500"
      >
        使用当前目录新建 Claude 会话
      </button>
      <p v-if="store.selectedProjectDir" class="mt-2 text-xs text-gray-500 break-all">
        {{ store.selectedProjectDir }}
      </p>
    </div>
  </div>
</template>
