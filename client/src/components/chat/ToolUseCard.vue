<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  toolName: string
  toolInput: Record<string, unknown>
  sourceLabel?: string
}>()

const label = computed(() => {
  const icons: Record<string, string> = {
    read: '[Read]',
    write: '[Write]',
    edit: '[Edit]',
    bash: '[Shell]',
    glob: '[Glob]',
    grep: '[Grep]',
    search: '[Search]',
  }
  const icon = icons[props.toolName] || '[Tool]'
  return `${icon} ${props.toolName}`
})

const summary = computed(() => {
  const input = props.toolInput
  if (input.file_path) return input.file_path as string
  if (input.pattern) return input.pattern as string
  if (input.command) return (input.command as string).slice(0, 60)
  if (input.path) return input.path as string
  const serialized = JSON.stringify(input)
  return serialized && serialized !== '{}' ? serialized.slice(0, 80) : '等待工具返回结果'
})
</script>

<template>
  <div class="mr-auto w-full min-w-0 max-w-[92%]">
    <div v-if="sourceLabel" class="mb-1.5 px-1 text-[11px] font-medium text-gray-500">
      {{ sourceLabel }}
    </div>
    <div class="rounded-xl border border-sky-900/50 bg-slate-900/90 px-3 py-2 text-xs">
      <div class="flex items-center gap-2">
        <span class="inline-flex h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
        <span class="font-medium text-sky-200">{{ label }}</span>
      </div>
      <div class="mt-1 pl-4 text-gray-300 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {{ summary }}
      </div>
    </div>
  </div>
</template>
