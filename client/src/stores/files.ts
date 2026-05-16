import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/utils/api'
import type { FileEntry, FileContent, FileRoot } from '@/types'

export const useFileStore = defineStore('files', () => {
  const roots = ref<FileRoot[]>([])
  const currentRootId = ref<string | null>(null)
  const currentPath = ref('.')
  const entries = ref<FileEntry[]>([])
  const loading = ref(false)
  const selectedFile = ref<FileContent | null>(null)

  const currentRoot = computed(() => roots.value.find(root => root.id === currentRootId.value) ?? null)
  const selectedProjectDir = computed(() => {
    const root = currentRoot.value
    if (!root) return null
    if (currentPath.value === '.') return root.path
    return `${root.path}/${currentPath.value}`.replace(/\//g, '/').replace(/\/+/g, '/')
  })

  async function loadRoots() {
    loading.value = true
    try {
      roots.value = await api.getFileRoots()
      if (!currentRootId.value && roots.value[0]) {
        currentRootId.value = roots.value[0].id
      }
    } finally {
      loading.value = false
    }
  }

  async function selectRoot(rootId: string) {
    currentRootId.value = rootId
    currentPath.value = '.'
    selectedFile.value = null
    await loadDirectory('.')
  }

  async function loadDirectory(path = '.') {
    if (!currentRootId.value) return
    loading.value = true
    try {
      entries.value = await api.listFiles(currentRootId.value, path)
      currentPath.value = path
    } finally {
      loading.value = false
    }
  }

  async function openFile(path: string) {
    if (!currentRootId.value) return
    loading.value = true
    try {
      selectedFile.value = await api.getFileContent(currentRootId.value, path)
    } finally {
      loading.value = false
    }
  }

  function closeFile() {
    selectedFile.value = null
  }

  return {
    roots,
    currentRootId,
    currentRoot,
    currentPath,
    entries,
    loading,
    selectedFile,
    selectedProjectDir,
    loadRoots,
    selectRoot,
    loadDirectory,
    openFile,
    closeFile,
  }
})
