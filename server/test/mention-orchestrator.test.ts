import test from 'node:test'
import assert from 'node:assert/strict'

import { runMentionConversation } from '../src/agents/orchestrator.ts'
import type {
  AgentMention,
  OrchestrationMetadata,
  ServerMsg,
  ToolAgentInfo,
  VibeToolInfo,
  VibeToolState,
} from '../src/types/index.ts'

function createAgent(name: string): ToolAgentInfo {
  return {
    id: `claude:${name}`,
    name,
    statusText: 'ready',
    state: 'ready' satisfies VibeToolState,
    description: `${name} role`,
    capabilities: [],
  }
}

function createTool(agents: ToolAgentInfo[]): VibeToolInfo {
  return {
    id: 'claude',
    label: 'Claude',
    command: 'claude',
    version: 'test',
    installed: true,
    configured: true,
    authenticated: true,
    state: 'ready',
    statusText: 'ready',
    detail: '',
    supportsExecution: true,
    supportsParallel: false,
    agentCount: agents.length,
    agents,
  }
}

test('runMentionConversation rejects mentions across different CLI tools', async () => {
  const mentions: AgentMention[] = [
    { toolId: 'claude', agentId: 'claude:lead', name: 'lead', order: 0 },
    { toolId: 'codex', agentId: 'codex:peer', name: 'peer', order: 1 },
  ]

  const result = await runMentionConversation({
    sessionId: 's1',
    projectDir: 'D:/demo/jkq-cc-connect',
    text: '@lead ask @peer',
    mentions,
    tool: createTool([createAgent('lead')]),
    manager: {} as never,
    savePublicMessage: () => undefined,
    publish: () => undefined,
    onUserMessage: () => undefined,
  })

  assert.equal(result.ok, false)
  assert.match(result.errorMessage || '', /same CLI tool/i)
})

test('runMentionConversation emits structured metadata for agent-to-agent and agent-to-user messages', async () => {
  const published: Array<ServerMsg & Partial<OrchestrationMetadata>> = []
  const agents = [createAgent('lead'), createAgent('peer')]

  let call = 0
  const manager = {
    isRunning: () => false,
    start: async () => {
      call += 1
      return call === 1
        ? { ok: true, tool: 'claude', producedOutput: true, recoverable: false, assistantText: 'peer reply' }
        : { ok: true, tool: 'claude', producedOutput: true, recoverable: false, assistantText: 'lead summary' }
    },
  }

  await runMentionConversation({
    sessionId: 's1',
    projectDir: 'D:/demo/jkq-cc-connect',
    text: '@lead check @peer',
    mentions: [
      { toolId: 'claude', agentId: 'claude:lead', name: 'lead', order: 0 },
      { toolId: 'claude', agentId: 'claude:peer', name: 'peer', order: 1 },
    ],
    tool: createTool(agents),
    manager: manager as never,
    savePublicMessage: (message) => published.push(message),
    publish: (message) => published.push(message),
    onUserMessage: () => undefined,
  })

  assert.ok(published.some(item => item.orchestrationStep === 'agent_to_agent'))
  assert.ok(published.some(item => item.orchestrationStep === 'agent_reply'))
  assert.ok(published.some(item => item.orchestrationStep === 'agent_to_user'))
})
