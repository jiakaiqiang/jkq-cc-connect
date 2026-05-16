import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

let gatewayTestEnvironment: {
  cleanup: () => void
} | null = null

function ensureGatewayTestEnvironment() {
  if (gatewayTestEnvironment) return gatewayTestEnvironment

  const previousEnv = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    PATH: process.env.PATH,
  }
  const testHome = mkdtempSync(join(tmpdir(), 'mention-orchestrator-'))
  const testBin = join(testHome, 'bin')
  const agentsDir = join(testHome, '.claude', 'agents')
  mkdirSync(testBin, { recursive: true })
  mkdirSync(agentsDir, { recursive: true })
  writeFileSync(join(testBin, 'claude.cmd'), '@echo off\r\necho 1.0.0\r\n')
  writeFileSync(join(agentsDir, 'lead.md'), '---\nname: lead\ndescription: Lead agent\n---\n## Responsibilities\n- Lead orchestration\n')
  writeFileSync(join(agentsDir, 'peer.md'), '---\nname: peer\ndescription: Peer agent\n---\n## Responsibilities\n- Peer collaboration\n')

  process.env.HOME = testHome
  process.env.USERPROFILE = testHome
  process.env.PATH = `${testBin};${previousEnv.PATH || ''}`

  gatewayTestEnvironment = {
    cleanup: () => {
      process.env.HOME = previousEnv.HOME
      process.env.USERPROFILE = previousEnv.USERPROFILE
      process.env.PATH = previousEnv.PATH
    },
  }

  return gatewayTestEnvironment
}

after(() => {
  gatewayTestEnvironment?.cleanup()
})

async function loadRunMentionConversation() {
  const module = await import('../src/agents/orchestrator.ts')
  return module.runMentionConversation
}

async function loadMentionValidation() {
  const module = await import('../src/agents/orchestrator.ts')
  return module.validateMentionConversationRequest
}

async function loadGatewayTestModules() {
  ensureGatewayTestEnvironment()

  const [
    { WSGateway },
    { getDb, applyMigrations },
    { createSession },
    { getMessages },
  ] = await Promise.all([
    import('../src/ws/gateway.ts'),
    import('../src/store/database.ts'),
    import('../src/store/sessions.ts'),
    import('../src/store/messages.ts'),
  ])

  const db = getDb()
  applyMigrations(db)

  return { WSGateway, createSession, getMessages }
}

test('WSGateway mention input persists and broadcasts the orchestration user-request lifecycle', async () => {
  const { WSGateway, createSession, getMessages } = await loadGatewayTestModules()
  const session = createSession({ projectDir: 'D:/demo/jkq-cc-connect' })
  const gateway = new WSGateway() as any
  const broadcasts: ServerMsg[] = []

  let running = true
  const manager = {
    isRunning: () => running,
    stop: async () => {
      running = false
    },
    start: async () => ({
      ok: true,
      tool: 'claude',
      producedOutput: true,
      recoverable: false,
      assistantText: 'lead summary',
    }),
  }

  gateway.broadcast = (_sessionId: string, message: ServerMsg) => {
    broadcasts.push(message)
  }
  gateway.clearStreamingMessage = () => undefined
  gateway.getManager = () => manager

  await gateway.handleInput(
    session.id,
    '@default answer this',
    undefined,
    [{ toolId: 'claude', agentId: 'claude:default', name: 'default', order: 0 }],
  )

  const persistedMessages = getMessages(session.id)
  const persistedUserMessage = persistedMessages.find(message => message.type === 'user')
  const persistedAgentReply = persistedMessages.find(message => message.type === 'text')
  const persistedAgentReplyIndex = persistedMessages.findIndex((message) =>
    message.type === 'text'
    && message.metadata.orchestrationStep === 'agent_to_user'
  )
  const broadcastUserMessage = broadcasts.find((message): message is Extract<ServerMsg, { type: 'user' }> => message.type === 'user')
  const broadcastAgentReply = broadcasts.find((message): message is Extract<ServerMsg, { type: 'text' }> => message.type === 'text')
  const broadcastUserMessageIndex = broadcasts.findIndex((message) => message.type === 'user')
  const broadcastAgentReplyIndex = broadcasts.findIndex((message) =>
    message.type === 'text'
    && message.orchestrationStep === 'agent_to_user'
  )

  assert.ok(persistedUserMessage)
  assert.equal(persistedUserMessage.metadata.senderType, 'user')
  assert.equal(persistedUserMessage.metadata.orchestrationStep, 'user_request')

  assert.ok(persistedAgentReply)
  assert.equal(persistedAgentReply.content, 'lead summary')
  assert.equal(persistedAgentReply.metadata.senderType, 'agent')
  assert.equal(persistedAgentReply.metadata.senderAgentId, 'claude:default')
  assert.equal(persistedAgentReply.metadata.targetAgentId, 'user')
  assert.equal(persistedAgentReply.metadata.orchestrationStep, 'agent_to_user')
  assert.ok(persistedUserMessage.seq < persistedAgentReply.seq)
  assert.ok(persistedAgentReplyIndex >= 0)
  assert.equal(persistedMessages[persistedAgentReplyIndex - 1]?.id, persistedUserMessage.id)

  assert.ok(broadcastUserMessage)
  assert.equal(broadcastUserMessage.senderType, 'user')
  assert.equal(broadcastUserMessage.orchestrationStep, 'user_request')

  assert.ok(broadcastAgentReply)
  assert.equal(broadcastAgentReply.content, 'lead summary')
  assert.equal(broadcastAgentReply.senderType, 'agent')
  assert.equal(broadcastAgentReply.senderAgentId, 'claude:default')
  assert.equal(broadcastAgentReply.targetAgentId, 'user')
  assert.equal(broadcastAgentReply.orchestrationStep, 'agent_to_user')
  assert.ok(broadcastUserMessageIndex >= 0)
  assert.ok(broadcastAgentReplyIndex >= 0)
  assert.ok(broadcastUserMessageIndex < broadcastAgentReplyIndex)
})

test('validateMentionConversationRequest resolves lead and collaborators for shared gateway/orchestrator mention validation', async () => {
  const validateMentionConversationRequest = await loadMentionValidation()
  const leadAgent = createAgent('lead')
  const peerAgent = createAgent('peer')

  const result = validateMentionConversationRequest({
    mentions: [
      { toolId: 'claude', agentId: 'claude:peer', name: 'peer', order: 2 },
      { toolId: 'claude', agentId: 'claude:lead', name: 'lead', order: 1 },
    ],
    tools: [createTool([leadAgent, peerAgent])],
    expectedToolId: 'claude',
  })

  assert.equal(result.ok, true)
  assert.equal(result.tool.id, 'claude')
  assert.equal(result.leadAgent.id, leadAgent.id)
  assert.deepEqual(result.collaboratorAgents.map((agent) => agent.id), [peerAgent.id])
})

test('WSGateway mention input persists and broadcasts the multi-agent orchestration lifecycle', async () => {
  const { WSGateway, createSession, getMessages } = await loadGatewayTestModules()
  const session = createSession({ projectDir: 'D:/demo/jkq-cc-connect' })
  const gateway = new WSGateway() as any
  const broadcasts: ServerMsg[] = []
  const startCalls: string[] = []

  const manager = {
    isRunning: () => false,
    start: async (_projectDir: string, _text: string, _tool: string, options?: { requestedAgentName?: string | null }) => {
      startCalls.push(options?.requestedAgentName || '')
      return startCalls.length === 1
        ? {
            ok: true,
            tool: 'claude',
            producedOutput: true,
            recoverable: false,
            assistantText: 'peer reply',
          }
        : {
            ok: true,
            tool: 'claude',
            producedOutput: true,
            recoverable: false,
            assistantText: 'lead summary',
          }
    },
  }

  gateway.broadcast = (_sessionId: string, message: ServerMsg) => {
    broadcasts.push(message)
  }
  gateway.clearStreamingMessage = () => undefined
  gateway.getManager = () => manager

  await gateway.handleInput(
    session.id,
    '@lead check @peer',
    undefined,
    [
      { toolId: 'claude', agentId: 'claude:lead', name: 'lead', order: 0 },
      { toolId: 'claude', agentId: 'claude:peer', name: 'peer', order: 1 },
    ],
  )

  const persistedEntries = getMessages(session.id)
    .filter((message) => message.type === 'user' || (message.type === 'text' && message.metadata.orchestrationStep))
    .map((message) => ({
      type: message.type,
      content: message.content,
      senderType: message.metadata.senderType,
      senderAgentId: message.metadata.senderAgentId,
      senderAgentName: message.metadata.senderAgentName,
      targetAgentId: message.metadata.targetAgentId,
      targetAgentName: message.metadata.targetAgentName,
      orchestrationStep: message.metadata.orchestrationStep,
    }))

  const broadcastEntries = broadcasts
    .filter((message) => message.type === 'user' || (message.type === 'text' && message.orchestrationStep))
    .map((message) => ({
      type: message.type,
      content: message.content,
      senderType: message.senderType,
      senderAgentId: message.senderAgentId,
      senderAgentName: message.senderAgentName,
      targetAgentId: message.targetAgentId,
      targetAgentName: message.targetAgentName,
      orchestrationStep: message.orchestrationStep,
    }))

  assert.deepEqual(startCalls, ['peer', 'lead'])
  assert.deepEqual(persistedEntries, [
    {
      type: 'user',
      content: '@lead check @peer',
      senderType: 'user',
      senderAgentId: undefined,
      senderAgentName: undefined,
      targetAgentId: undefined,
      targetAgentName: undefined,
      orchestrationStep: 'user_request',
    },
    {
      type: 'text',
      content: '@peer please share the most relevant context for: @lead check @peer',
      senderType: 'agent',
      senderAgentId: 'claude:lead',
      senderAgentName: 'lead',
      targetAgentId: 'claude:peer',
      targetAgentName: 'peer',
      orchestrationStep: 'agent_to_agent',
    },
    {
      type: 'text',
      content: 'peer reply',
      senderType: 'agent',
      senderAgentId: 'claude:peer',
      senderAgentName: 'peer',
      targetAgentId: 'claude:lead',
      targetAgentName: 'lead',
      orchestrationStep: 'agent_reply',
    },
    {
      type: 'text',
      content: 'lead summary',
      senderType: 'agent',
      senderAgentId: 'claude:lead',
      senderAgentName: 'lead',
      targetAgentId: 'user',
      targetAgentName: 'user',
      orchestrationStep: 'agent_to_user',
    },
  ])
  assert.deepEqual(broadcastEntries, persistedEntries)
})

test('WSGateway rejects invalid mention input without interrupting a running manager', async () => {
  const { WSGateway, createSession, getMessages } = await loadGatewayTestModules()
  const session = createSession({ projectDir: 'D:/demo/jkq-cc-connect' })
  const gateway = new WSGateway() as any
  const broadcasts: ServerMsg[] = []
  const clearStreamingMessageCalls: Array<{ sessionId: string; type?: 'text' | 'thinking' }> = []

  let stopCalls = 0
  const manager = {
    isRunning: () => true,
    stop: async () => {
      stopCalls += 1
    },
    start: async () => {
      throw new Error('start should not be called for invalid mentions')
    },
  }

  gateway.broadcast = (_sessionId: string, message: ServerMsg) => {
    broadcasts.push(message)
  }
  gateway.clearStreamingMessage = (sessionId: string, type?: 'text' | 'thinking') => {
    clearStreamingMessageCalls.push({ sessionId, type })
  }
  gateway.getManager = () => manager

  await gateway.handleInput(
    session.id,
    '@lead ask @peer',
    undefined,
    [
      { toolId: 'claude', agentId: 'claude:lead', name: 'lead', order: 0 },
      { toolId: 'codex', agentId: 'codex:peer', name: 'peer', order: 1 },
    ],
  )

  const persistedMessages = getMessages(session.id)
  const persistedUserMessages = persistedMessages.filter(message => message.type === 'user')
  const broadcastUserMessages = broadcasts.filter((message) => message.type === 'user')
  const broadcastError = broadcasts.find((message): message is Extract<ServerMsg, { type: 'error' }> => message.type === 'error')

  assert.equal(stopCalls, 0)
  assert.equal(clearStreamingMessageCalls.length, 0)
  assert.equal(persistedUserMessages.length, 0)
  assert.equal(broadcastUserMessages.length, 0)
  assert.ok(broadcastError)
  assert.match(broadcastError.message, /same CLI tool/i)
})

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

test('runMentionConversation rejects more than 3 mentioned agents', async () => {
  const mentions: AgentMention[] = [
    { toolId: 'claude', agentId: 'claude:a', name: 'a', order: 0 },
    { toolId: 'claude', agentId: 'claude:b', name: 'b', order: 1 },
    { toolId: 'claude', agentId: 'claude:c', name: 'c', order: 2 },
    { toolId: 'claude', agentId: 'claude:d', name: 'd', order: 3 },
  ]

  const runMentionConversation = await loadRunMentionConversation()
  const result = await runMentionConversation({
    sessionId: 's1',
    projectDir: 'D:/demo/jkq-cc-connect',
    text: '@a ask @b @c @d',
    mentions,
    tool: createTool([createAgent('a'), createAgent('b'), createAgent('c'), createAgent('d')]),
    manager: {} as never,
    savePublicMessage: () => undefined,
    publish: () => undefined,
    onUserMessage: () => undefined,
  })

  assert.equal(result.ok, false)
  assert.match(result.errorMessage || '', /at most 3 agents/i)
})

test('runMentionConversation fails when a single mentioned agent returns blank assistant text', async () => {
  const published: ServerMsg[] = []
  const manager = {
    isRunning: () => false,
    start: async () => ({ ok: true, tool: 'claude', producedOutput: true, recoverable: false, assistantText: '   ' }),
  }

  const runMentionConversation = await loadRunMentionConversation()
  const result = await runMentionConversation({
    sessionId: 's1',
    projectDir: 'D:/demo/jkq-cc-connect',
    text: '@lead answer this',
    mentions: [
      { toolId: 'claude', agentId: 'claude:lead', name: 'lead', order: 0 },
    ],
    tool: createTool([createAgent('lead')]),
    manager: manager as never,
    savePublicMessage: (message) => published.push(message),
    publish: (message) => published.push(message),
    onUserMessage: () => undefined,
  })

  assert.equal(result.ok, false)
  assert.match(result.errorMessage || '', /did not provide a usable reply/i)
  assert.equal(published.length, 0)
})

test('runMentionConversation surfaces usable assistant text from a failed single-agent lead run', async () => {
  const saved: ServerMsg[] = []
  const published: ServerMsg[] = []
  const manager = {
    isRunning: () => false,
    start: async () => ({
      ok: false,
      tool: 'claude',
      producedOutput: true,
      recoverable: true,
      errorMessage: 'lead failed after producing text',
      assistantText: '  lead fallback reply  ',
    }),
  }

  const runMentionConversation = await loadRunMentionConversation()
  const result = await runMentionConversation({
    sessionId: 's1',
    projectDir: 'D:/demo/jkq-cc-connect',
    text: '@lead answer this',
    mentions: [
      { toolId: 'claude', agentId: 'claude:lead', name: 'lead', order: 0 },
    ],
    tool: createTool([createAgent('lead')]),
    manager: manager as never,
    savePublicMessage: (message) => saved.push(message),
    publish: (message) => published.push(message),
    onUserMessage: () => undefined,
  })

  assert.equal(result.ok, false)
  assert.equal(result.assistantText, 'lead fallback reply')
  assert.equal(saved.length, 1)
  assert.equal(published.length, 1)
  assert.equal(saved[0]?.type, 'text')
  assert.equal(saved[0]?.content, 'lead fallback reply')
  assert.equal(saved[0]?.orchestrationStep, 'agent_to_user')
  assert.equal(published[0]?.type, 'text')
  assert.equal(published[0]?.content, 'lead fallback reply')
  assert.equal(published[0]?.orchestrationStep, 'agent_to_user')
})

test('runMentionConversation requests suppressed runtime assistant broadcasts for single-agent mention runs', async () => {
  const startCalls: Array<{ requestedAgentName?: string | null; suppressAssistantMessageBroadcast?: boolean }> = []
  const manager = {
    isRunning: () => false,
    start: async (
      _projectDir: string,
      _text: string,
      _toolId: string,
      options?: { requestedAgentName?: string | null; suppressAssistantMessageBroadcast?: boolean },
    ) => {
      startCalls.push({
        requestedAgentName: options?.requestedAgentName,
        suppressAssistantMessageBroadcast: options?.suppressAssistantMessageBroadcast,
      })
      return { ok: true, tool: 'claude', producedOutput: true, recoverable: false, assistantText: 'lead summary' }
    },
  }

  const runMentionConversation = await loadRunMentionConversation()
  const result = await runMentionConversation({
    sessionId: 's1',
    projectDir: 'D:/demo/jkq-cc-connect',
    text: '@lead answer this',
    mentions: [
      { toolId: 'claude', agentId: 'claude:lead', name: 'lead', order: 0 },
    ],
    tool: createTool([createAgent('lead')]),
    manager: manager as never,
    savePublicMessage: () => undefined,
    publish: () => undefined,
    onUserMessage: () => undefined,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(startCalls, [
    {
      requestedAgentName: 'lead',
      suppressAssistantMessageBroadcast: true,
    },
  ])
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

test('runMentionConversation normalizes mention order before resolving lead and collaborators', async () => {
  const startCalls: Array<{ requestedAgentName?: string | null; preamble?: string }> = []
  const leadAgent = createAgent('lead')
  const peerAgent = createAgent('peer')

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
        ? { ok: true, tool: 'claude', producedOutput: true, recoverable: false, assistantText: 'peer reply' }
        : { ok: true, tool: 'claude', producedOutput: true, recoverable: false, assistantText: 'lead summary' }
    },
  }

  const runMentionConversation = await loadRunMentionConversation()
  const result = await runMentionConversation({
    sessionId: 's1',
    projectDir: 'D:/demo/jkq-cc-connect',
    text: '@peer check with @lead',
    mentions: [
      { toolId: 'claude', agentId: 'claude:peer', name: 'peer', order: 2 },
      { toolId: 'claude', agentId: 'claude:lead', name: 'lead', order: 1 },
    ],
    tool: createTool([leadAgent, peerAgent]),
    manager: manager as never,
    savePublicMessage: () => undefined,
    publish: () => undefined,
    onUserMessage: () => undefined,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(startCalls.map((entry) => entry.requestedAgentName), ['peer', 'lead'])
  assert.match(startCalls[0].preamble || '', /lead/i)
})

test('runMentionConversation requests suppressed runtime assistant broadcasts for collaborator and lead mention runs', async () => {
  const startCalls: Array<{ requestedAgentName?: string | null; suppressAssistantMessageBroadcast?: boolean }> = []
  const leadAgent = createAgent('lead')
  const peerAgent = createAgent('peer')

  let call = 0
  const manager = {
    isRunning: () => false,
    start: async (
      _projectDir: string,
      _text: string,
      _toolId: string,
      options?: { requestedAgentName?: string | null; suppressAssistantMessageBroadcast?: boolean },
    ) => {
      call += 1
      startCalls.push({
        requestedAgentName: options?.requestedAgentName,
        suppressAssistantMessageBroadcast: options?.suppressAssistantMessageBroadcast,
      })

      return call === 1
        ? { ok: true, tool: 'claude', producedOutput: true, recoverable: false, assistantText: 'peer reply' }
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
    savePublicMessage: () => undefined,
    publish: () => undefined,
    onUserMessage: () => undefined,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(startCalls, [
    {
      requestedAgentName: 'peer',
      suppressAssistantMessageBroadcast: true,
    },
    {
      requestedAgentName: 'lead',
      suppressAssistantMessageBroadcast: true,
    },
  ])
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

test('runMentionConversation surfaces collaborator assistant text even when the collaborator run is non-ok', async () => {
  const saved: ServerMsg[] = []
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
        ? {
            ok: false,
            tool: 'claude',
            producedOutput: true,
            recoverable: true,
            errorMessage: 'peer failed after producing text',
            assistantText: '  peer reply despite failure  ',
          }
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
    publish: () => undefined,
    onUserMessage: () => undefined,
  })

  assert.equal(result.ok, true)
  assert.equal(startCalls.length, 2)
  assert.equal(startCalls[1]?.requestedAgentName, 'lead')
  assert.match(startCalls[1]?.preamble || '', /peer reply despite failure/i)
  assert.doesNotMatch(startCalls[1]?.preamble || '', /did not provide a usable reply/i)

  const collaboratorReply = saved.find((message) =>
    message.type === 'text'
    && message.orchestrationStep === 'agent_reply'
    && message.senderAgentId === peerAgent.id
  )

  assert.ok(collaboratorReply)
  assert.equal(collaboratorReply.content, 'peer reply despite failure')
})

test('runMentionConversation surfaces usable assistant text from a failed final lead run', async () => {
  const saved: ServerMsg[] = []
  const published: ServerMsg[] = []
  const leadAgent = createAgent('lead')
  const peerAgent = createAgent('peer')

  let call = 0
  const manager = {
    isRunning: () => false,
    start: async () => {
      call += 1
      return call === 1
        ? { ok: true, tool: 'claude', producedOutput: true, recoverable: false, assistantText: 'peer reply' }
        : {
            ok: false,
            tool: 'claude',
            producedOutput: true,
            recoverable: true,
            errorMessage: 'lead failed after producing text',
            assistantText: '  lead summary despite failure  ',
          }
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

  assert.equal(result.ok, false)
  assert.equal(result.assistantText, 'lead summary despite failure')

  const finalSaved = saved.find((message) =>
    message.type === 'text'
    && message.orchestrationStep === 'agent_to_user'
    && message.senderAgentId === leadAgent.id
  )
  const finalPublished = published.find((message) =>
    message.type === 'text'
    && message.orchestrationStep === 'agent_to_user'
    && message.senderAgentId === leadAgent.id
  )

  assert.ok(finalSaved)
  assert.equal(finalSaved.content, 'lead summary despite failure')
  assert.ok(finalPublished)
  assert.equal(finalPublished.content, 'lead summary despite failure')
})

test('WSGateway mention orchestration does not persist or rebroadcast simulated raw runtime assistant text', async () => {
  const { WSGateway, createSession, getMessages } = await loadGatewayTestModules()
  const session = createSession({ projectDir: 'D:/demo/jkq-cc-connect' })
  const gateway = new WSGateway() as any
  const broadcasts: ServerMsg[] = []
  const startCalls: Array<{ requestedAgentName?: string | null; suppressAssistantMessageBroadcast?: boolean }> = []

  let call = 0
  const manager = {
    isRunning: () => false,
    start: async (
      _projectDir: string,
      _text: string,
      _toolId: string,
      options?: { requestedAgentName?: string | null; suppressAssistantMessageBroadcast?: boolean },
    ) => {
      call += 1
      startCalls.push({
        requestedAgentName: options?.requestedAgentName,
        suppressAssistantMessageBroadcast: options?.suppressAssistantMessageBroadcast,
      })

      if (!options?.suppressAssistantMessageBroadcast) {
        gateway.broadcast(session.id, {
          type: 'text',
          content: `raw runtime assistant text ${call}`,
          messageId: `raw-${call}`,
        })
      }

      return call === 1
        ? { ok: true, tool: 'claude', producedOutput: true, recoverable: false, assistantText: 'peer reply' }
        : { ok: true, tool: 'claude', producedOutput: true, recoverable: false, assistantText: 'lead summary' }
    },
  }

  gateway.broadcast = (_sessionId: string, message: ServerMsg) => {
    broadcasts.push(message)
  }
  gateway.clearStreamingMessage = () => undefined
  gateway.getManager = () => manager

  await gateway.handleInput(
    session.id,
    '@lead check @peer',
    undefined,
    [
      { toolId: 'claude', agentId: 'claude:lead', name: 'lead', order: 0 },
      { toolId: 'claude', agentId: 'claude:peer', name: 'peer', order: 1 },
    ],
  )

  assert.deepEqual(startCalls, [
    {
      requestedAgentName: 'peer',
      suppressAssistantMessageBroadcast: true,
    },
    {
      requestedAgentName: 'lead',
      suppressAssistantMessageBroadcast: true,
    },
  ])

  const runtimeBroadcasts = broadcasts.filter((message) =>
    message.type === 'text' && message.content.includes('raw runtime assistant text')
  )
  const runtimePersisted = getMessages(session.id).filter((message) =>
    message.type === 'text' && message.content.includes('raw runtime assistant text')
  )

  assert.equal(runtimeBroadcasts.length, 0)
  assert.equal(runtimePersisted.length, 0)
})
