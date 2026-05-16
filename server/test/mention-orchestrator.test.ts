import test from 'node:test'
import assert from 'node:assert/strict'

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

async function loadRunMentionConversation() {
  const module = await import('../src/agents/orchestrator.ts')
  return module.runMentionConversation
}

test('runMentionConversation rejects mentions across different CLI tools', async () => {
  const mentions: AgentMention[] = [
    { toolId: 'claude', agentId: 'claude:lead', name: 'lead', order: 0 },
    { toolId: 'codex', agentId: 'codex:peer', name: 'peer', order: 1 },
  ]

  const runMentionConversation = await loadRunMentionConversation()
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
  const saved: Array<ServerMsg & Partial<OrchestrationMetadata>> = []
  const published: Array<ServerMsg & Partial<OrchestrationMetadata>> = []
  const leadAgent = createAgent('lead')
  const peerAgent = createAgent('peer')
  const agents = [leadAgent, peerAgent]

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

  const runMentionConversation = await loadRunMentionConversation()
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
    savePublicMessage: (message) => saved.push(message),
    publish: (message) => published.push(message),
    onUserMessage: () => undefined,
  })

  const expectedEntries = [
    {
      type: 'text',
      senderType: 'agent',
      senderAgentId: leadAgent.id,
      senderAgentName: leadAgent.name,
      targetAgentId: peerAgent.id,
      targetAgentName: peerAgent.name,
      orchestrationStep: 'agent_to_agent',
    },
    {
      type: 'text',
      senderType: 'agent',
      senderAgentId: peerAgent.id,
      senderAgentName: peerAgent.name,
      targetAgentId: leadAgent.id,
      targetAgentName: leadAgent.name,
      orchestrationStep: 'agent_reply',
    },
    {
      type: 'text',
      senderType: 'agent',
      senderAgentId: leadAgent.id,
      senderAgentName: leadAgent.name,
      targetAgentId: 'user',
      targetAgentName: 'user',
      orchestrationStep: 'agent_to_user',
    },
  ] as const

  const savedEntries = saved
    .filter((item): item is ServerMsg & Partial<OrchestrationMetadata> & Required<Pick<OrchestrationMetadata, 'orchestrationStep'>> => !!item.orchestrationStep)
    .map(item => ({
      type: item.type,
      senderType: item.senderType,
      senderAgentId: item.senderAgentId,
      senderAgentName: item.senderAgentName,
      targetAgentId: item.targetAgentId,
      targetAgentName: item.targetAgentName,
      orchestrationStep: item.orchestrationStep,
    }))

  const publishedEntries = published
    .filter((item): item is ServerMsg & Partial<OrchestrationMetadata> & Required<Pick<OrchestrationMetadata, 'orchestrationStep'>> => !!item.orchestrationStep)
    .map(item => ({
      type: item.type,
      senderType: item.senderType,
      senderAgentId: item.senderAgentId,
      senderAgentName: item.senderAgentName,
      targetAgentId: item.targetAgentId,
      targetAgentName: item.targetAgentName,
      orchestrationStep: item.orchestrationStep,
    }))

  assert.deepEqual(savedEntries, expectedEntries)
  assert.deepEqual(publishedEntries, expectedEntries)
})

test('runMentionConversation falls back to a visible collaborator reply and still completes the lead summary', async () => {
  const saved: ServerMsg[] = []
  const published: ServerMsg[] = []
  const leadAgent = createAgent('lead')
  const peerAgent = createAgent('peer')
  const startCalls: Array<{ requestedAgentName?: string | null; preamble?: string }> = []

  let call = 0
  const manager = {
    isRunning: () => false,
    start: async (_projectDir: string, _text: string, _toolId: string, options?: { requestedAgentName?: string | null; preamble?: string }) => {
      call += 1
      startCalls.push({
        requestedAgentName: options?.requestedAgentName,
        preamble: options?.preamble,
      })

      return call === 1
        ? { ok: false, tool: 'claude', producedOutput: false, recoverable: true, errorMessage: 'peer failed' }
        : { ok: true, tool: 'claude', producedOutput: true, recoverable: false, assistantText: 'lead summary' }
    },
  }

  const runMentionConversation = await loadRunMentionConversation()
  const result = await runMentionConversation({
    sessionId: 's1',
    projectDir: 'D:/demo/jkq-cc-connect',
    text: '@lead check @peer',
    mentions: [
      { toolId: 'claude', agentId: 'claude:lead', name: 'lead', order: 0 },
      { toolId: 'claude', agentId: 'claude:peer', name: 'peer', order: 1 },
    ],
    tool: createTool([leadAgent, peerAgent]),
    manager: manager as never,
    savePublicMessage: (message) => saved.push(message),
    publish: (message) => published.push(message),
    onUserMessage: () => undefined,
  })

  assert.equal(result.ok, true)
  assert.equal(startCalls.length, 2)
  assert.deepEqual(startCalls.map(call => call.requestedAgentName), ['peer', 'lead'])
  assert.match(startCalls[1].preamble || '', /peer/i)
  assert.match(startCalls[1].preamble || '', /did not provide a usable reply/i)

  const savedCollaboratorReply = saved.find((message) =>
    message.type === 'text'
    && message.orchestrationStep === 'agent_reply'
    && message.senderAgentId === peerAgent.id
  )

  const publishedCollaboratorReply = published.find((message) =>
    message.type === 'text'
    && message.orchestrationStep === 'agent_reply'
    && message.senderAgentId === peerAgent.id
  )

  assert.ok(savedCollaboratorReply)
  assert.match(savedCollaboratorReply.content, /did not provide a usable reply/i)
  assert.ok(publishedCollaboratorReply)
  assert.match(publishedCollaboratorReply.content, /did not provide a usable reply/i)
})
