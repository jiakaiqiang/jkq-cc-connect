import test from 'node:test'
import assert from 'node:assert/strict'

import { createPinia, setActivePinia } from 'pinia'
import { useVibeStore } from '../src/stores/vibe.ts'

function createLocalStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
    removeItem(key: string) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

test.beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: createLocalStorageMock(),
  })
  setActivePinia(createPinia())
})

test('fallback style temporary mode switch does not overwrite user preferred mode', () => {
  const vibe = useVibeStore()

  vibe.setMode('claude')
  assert.equal(vibe.preferredMode, 'claude')
  assert.equal(vibe.selectedMode, 'claude')

  vibe.setMode('codex', false)
  assert.equal(vibe.preferredMode, 'claude')
  assert.equal(vibe.activeMode, 'codex')
  assert.equal(vibe.selectedMode, 'codex')

  vibe.clearActiveMode()
  assert.equal(vibe.preferredMode, 'claude')
  assert.equal(vibe.activeMode, null)
  assert.equal(vibe.selectedMode, 'claude')
})

test('persisted mode changes replace the preferred mode and clear transient overrides', () => {
  const vibe = useVibeStore()

  vibe.setMode('claude')
  vibe.setMode('opencode', false)
  assert.equal(vibe.selectedMode, 'opencode')

  vibe.setMode('codex')
  assert.equal(vibe.preferredMode, 'codex')
  assert.equal(vibe.activeMode, null)
  assert.equal(vibe.selectedMode, 'codex')
  assert.equal(globalThis.localStorage.getItem('cc-vibe-mode'), 'codex')
})
