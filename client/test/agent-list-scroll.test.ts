import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('AgentsView keeps the agent list in its own scroll container', () => {
  const source = readFileSync(resolve('src/views/AgentsView.vue'), 'utf8')

  assert.match(
    source,
    /<section class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-900\/70">/,
  )
  assert.match(
    source,
    /<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain \[-webkit-overflow-scrolling:touch\] px-2\.5 py-2\.5">/,
  )
})

test('ChatHeader keeps the agent panel list in its own scroll container', () => {
  const source = readFileSync(resolve('src/components/chat/ChatHeader.vue'), 'utf8')

  assert.match(
    source,
    /<div v-else class="flex max-h-\[60vh\] min-h-0 flex-col gap-3">/,
  )
  assert.match(
    source,
    /<div class="min-h-0 overflow-y-auto overscroll-contain pr-1 \[-webkit-overflow-scrolling:touch\]">/,
  )
})
