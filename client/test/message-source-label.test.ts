import test from 'node:test'
import assert from 'node:assert/strict'

import { createPinia, setActivePinia } from 'pinia'
import { useChatStore } from '../src/stores/chat.ts'
import {
  getMessageBubbleSourceProps,
  resolveMessageSourceLabel,
} from '../src/components/chat/sourceLabel.ts'

test.beforeEach(() => {
  setActivePinia(createPinia())
})

test('chat store preserves orchestration metadata from incoming server messages', () => {
  const chat = useChatStore()

  chat.addMessage({
    type: 'text',
    content: 'peer reply',
    messageId: 'm1',
    source: 'claude',
    sourceLabel: 'Claude / peer -> lead',
    senderType: 'agent',
    senderAgentId: 'claude:peer',
    senderAgentName: 'peer',
    targetAgentId: 'claude:lead',
    targetAgentName: 'lead',
    orchestrationStep: 'agent_reply',
  })

  assert.equal(chat.messages[0].metadata.senderType, 'agent')
  assert.equal(chat.messages[0].metadata.targetAgentName, 'lead')
  assert.equal(chat.messages[0].metadata.orchestrationStep, 'agent_reply')
})

test('resolveMessageSourceLabel builds agent-to-agent labels from structured metadata when sourceLabel is absent', () => {
  const label = resolveMessageSourceLabel({
    sourceLabel: undefined,
    senderAgentName: 'peer',
    targetAgentName: 'lead',
  })

  assert.equal(label, 'peer -> lead')
})

test('chat store prefers orchestration labels over plain source fallbacks when sourceLabel is omitted', () => {
  const chat = useChatStore()

  chat.addMessage({
    type: 'text',
    content: 'peer reply',
    messageId: 'm2',
    source: 'claude',
    senderType: 'agent',
    senderAgentId: 'claude:peer',
    senderAgentName: 'peer',
    targetAgentId: 'claude:lead',
    targetAgentName: 'lead',
    orchestrationStep: 'agent_reply',
  })

  assert.equal(chat.messages[0].metadata.sourceLabel, 'peer -> lead')
})

test('chat store uses metadata-aware labels for active tool use state', () => {
  const chat = useChatStore()

  chat.addMessage({
    type: 'tool_use',
    toolName: 'Read',
    toolInput: { file: 'foo.ts' },
    messageId: 'm3',
    source: 'claude',
    senderType: 'agent',
    senderAgentId: 'claude:peer',
    senderAgentName: 'peer',
    targetAgentId: 'claude:lead',
    targetAgentName: 'lead',
    orchestrationStep: 'agent_to_agent',
  })

  assert.equal(chat.activeToolUse?.sourceLabel, 'peer -> lead')
  assert.equal(chat.messages[0].metadata.sourceLabel, 'peer -> lead')
})

test('getMessageBubbleSourceProps preserves orchestration metadata for persisted messages', () => {
  const props = getMessageBubbleSourceProps({
    source: 'claude',
    senderAgentName: 'peer',
    targetAgentName: 'lead',
    orchestrationStep: 'agent_reply',
  })

  assert.deepEqual(props, {
    sourceLabel: undefined,
    senderAgentName: 'peer',
    targetAgentName: 'lead',
    orchestrationStep: 'agent_reply',
  })
  assert.equal(resolveMessageSourceLabel(props), 'peer -> lead')
})
