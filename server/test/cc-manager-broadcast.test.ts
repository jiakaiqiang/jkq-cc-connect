import test from 'node:test'
import assert from 'node:assert/strict'

import { CCManager } from '../src/cc/manager.ts'
import type { ServerMsg } from '../src/types/index.ts'

test('CCManager suppresses Codex assistant text broadcasts while preserving captured output', () => {
  const manager = new CCManager() as any
  const broadcasts: ServerMsg[] = []
  manager.setBroadcast((msg: ServerMsg) => broadcasts.push(msg))

  const outcome = manager.handleCodexEvent(
    JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'suppressed codex reply',
      },
    }),
    { suppressAssistantMessageBroadcast: true },
  )

  assert.equal(outcome.producedAssistantOutput, true)
  assert.equal(outcome.outputText, 'suppressed codex reply')
  assert.deepEqual(broadcasts, [])
})

test('CCManager suppresses OpenCode assistant text broadcasts while preserving captured output', () => {
  const manager = new CCManager() as any
  const broadcasts: ServerMsg[] = []
  manager.setBroadcast((msg: ServerMsg) => broadcasts.push(msg))

  const outcome = manager.handleOpenCodeEvent(
    JSON.stringify({
      type: 'text',
      part: {
        text: 'suppressed opencode reply',
      },
    }),
    { suppressAssistantMessageBroadcast: true },
    () => 'open-code-message',
  )

  assert.equal(outcome.producedAssistantOutput, true)
  assert.equal(outcome.outputText, 'suppressed opencode reply')
  assert.deepEqual(broadcasts, [])
})

test('CCManager still broadcasts non-assistant errors when assistant message suppression is enabled', () => {
  const manager = new CCManager() as any
  const broadcasts: ServerMsg[] = []
  manager.setBroadcast((msg: ServerMsg) => broadcasts.push(msg))

  const outcome = manager.handleCodexEvent(
    JSON.stringify({
      type: 'error',
      message: 'network issue',
    }),
    { suppressAssistantMessageBroadcast: true },
  )

  assert.equal(outcome.producedAssistantOutput, false)
  assert.equal(outcome.errorMessage, 'network issue')
  assert.deepEqual(broadcasts, [
    {
      type: 'error',
      message: 'Codex: network issue',
    },
  ])
})
