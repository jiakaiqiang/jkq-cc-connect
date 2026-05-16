# Agent Mention Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract mention orchestration into a dedicated server module, add structured sender/target metadata, and update the client to render public agent-to-agent flows from metadata.

**Architecture:** Keep `CCManager` as a single-agent executor and move mention policy into a new orchestrator module consumed by `WSGateway`. Preserve compatibility with existing `source` metadata while adding structured orchestration fields used by both persistence and client rendering.

**Tech Stack:** Node.js, TypeScript, Express, `ws`, Vue 3, Pinia, node test runner, SQLite metadata persistence

---

## File Map

- Create: `server/src/agents/orchestrator.ts`
- Create: `server/test/mention-orchestrator.test.ts`
- Create: `client/test/message-source-label.test.ts`
- Create: `client/src/components/chat/sourceLabel.ts`
- Modify: `server/src/types/index.ts`
- Modify: `server/src/ws/gateway.ts`
- Modify: `client/src/types/index.ts`
- Modify: `client/src/stores/chat.ts`
- Modify: `client/src/components/chat/MessageBubble.vue`

### Task 1: Define Structured Orchestration Metadata and Server Failing Tests

**Files:**
- Create: `server/test/mention-orchestrator.test.ts`
- Modify: `server/src/types/index.ts`

- [ ] **Step 1: Write the failing server tests**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import type { AgentMention, ToolAgentInfo, VibeToolInfo } from '../src/types/index.ts'
import { runMentionConversation } from '../src/agents/orchestrator.ts'

function createAgent(name: string): ToolAgentInfo {
  return {
    id: `claude:${name}`,
    name,
    statusText: 'ready',
    state: 'ready',
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
  const published: Array<Record<string, unknown>> = []
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -w server -- server/test/mention-orchestrator.test.ts`
Expected: FAIL because `../src/agents/orchestrator.ts` and structured metadata types do not exist yet.

- [ ] **Step 3: Add metadata types in `server/src/types/index.ts`**

```ts
export type OrchestrationStep =
  | 'user_request'
  | 'agent_to_agent'
  | 'agent_reply'
  | 'agent_to_user'

export interface OrchestrationMetadata {
  senderType: 'user' | 'agent' | 'system'
  senderAgentId?: string
  senderAgentName?: string
  targetAgentId?: string
  targetAgentName?: string
  orchestrationStep?: OrchestrationStep
}
```

```ts
type ServerMsgWithSource = {
  source?: MessageSource
  sourceLabel?: string
  sourceAgent?: string
  sourceAgentLabel?: string
} & Partial<OrchestrationMetadata>

export type ServerMsg =
  | { type: 'text'; content: string; messageId: string } & ServerMsgWithSource
  | { type: 'thinking'; content: string; messageId: string } & ServerMsgWithSource
  | { type: 'thinking_done'; messageId: string } & ServerMsgWithSource
  | { type: 'code'; lang: string; content: string; messageId: string } & ServerMsgWithSource
  | { type: 'diff'; content: string; messageId: string } & ServerMsgWithSource
  | { type: 'tool_use'; toolName: string; toolInput: Record<string, unknown>; messageId: string } & ServerMsgWithSource
  | { type: 'tool_result'; content: string; messageId: string; parentId: string } & ServerMsgWithSource
  | { type: 'error'; message: string } & ServerMsgWithSource
  | { type: 'user'; content: string; messageId: string; senderType?: 'user'; orchestrationStep?: 'user_request' }
  | { type: 'auth_ok'; session: SessionInfo }
  | { type: 'auth_error'; message: string }
  | { type: 'mode_changed'; mode: ToolExecutionMode; reason?: string }
  | { type: 'session_updated'; session: SessionInfo }
  | { type: 'confirm_request'; requestId: string; message: string; toolName: string }
  | { type: 'status'; state: CCStatus }
  | { type: 'session_state'; messages: Message[]; session: SessionInfo; hasMore: boolean; oldestSeq: number | null }
  | { type: 'pong' }
```

- [ ] **Step 4: Run server test again**

Run: `npm.cmd test -w server -- server/test/mention-orchestrator.test.ts`
Expected: FAIL because `runMentionConversation` is still missing, but TypeScript now accepts the metadata shape.

- [ ] **Step 5: Commit**

```bash
git add server/src/types/index.ts server/test/mention-orchestrator.test.ts
git commit -m "test: define mention orchestration metadata contract"
```

### Task 2: Implement the Mention Orchestrator

**Files:**
- Create: `server/src/agents/orchestrator.ts`
- Test: `server/test/mention-orchestrator.test.ts`

- [ ] **Step 1: Write the next failing test for collaborator failure fallback**

```ts
test('runMentionConversation continues to final summary when one collaborator has no usable reply', async () => {
  const published: Array<Record<string, unknown>> = []
  const agents = [createAgent('lead'), createAgent('peer')]

  let call = 0
  const manager = {
    isRunning: () => false,
    start: async () => {
      call += 1
      return call === 1
        ? { ok: false, tool: 'claude', producedOutput: false, recoverable: true, errorMessage: 'peer failed' }
        : { ok: true, tool: 'claude', producedOutput: true, recoverable: false, assistantText: 'lead summary' }
    },
  }

  const result = await runMentionConversation({
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

  assert.equal(result.ok, true)
  assert.ok(published.some(item => item.senderType === 'system' || item.orchestrationStep === 'agent_reply'))
  assert.ok(published.some(item => item.orchestrationStep === 'agent_to_user'))
})
```

- [ ] **Step 2: Run the focused server test**

Run: `npm.cmd test -w server -- server/test/mention-orchestrator.test.ts`
Expected: FAIL because the orchestrator implementation still does not exist.

- [ ] **Step 3: Implement `server/src/agents/orchestrator.ts` with a narrow interface**

```ts
import crypto from 'node:crypto'
import type { CCManager, ToolExecutionResult } from '../cc/manager.js'
import type {
  AgentMention,
  OrchestrationMetadata,
  OrchestrationStep,
  ServerMsg,
  ToolAgentInfo,
  VibeToolId,
  VibeToolInfo,
} from '../types/index.js'

interface MentionConversationContext {
  sessionId: string
  projectDir: string
  text: string
  mentions: AgentMention[]
  tool: VibeToolInfo
  manager: CCManager
  onUserMessage: () => void
  savePublicMessage: (payload: Record<string, unknown>) => void
  publish: (msg: ServerMsg) => void
}

export async function runMentionConversation(context: MentionConversationContext) {
  const validationError = validateMentions(context.mentions, context.tool)
  if (validationError) {
    return { ok: false, errorMessage: validationError }
  }

  const leadAgent = resolveAgent(context.tool, context.mentions[0])
  if (!leadAgent) return { ok: false, errorMessage: `Unable to resolve agent ${context.mentions[0].name}.` }

  const collaborators = context.mentions.slice(1).map(mention => resolveAgent(context.tool, mention))
  if (collaborators.some(agent => !agent)) {
    return { ok: false, errorMessage: 'One or more mentioned agents could not be resolved for the current CLI.' }
  }

  context.onUserMessage()

  if (!collaborators.length) {
    await context.manager.start(context.projectDir, context.text, context.tool.id, {
      requestedAgentName: leadAgent.name,
      requestedAgentLabel: leadAgent.name,
      preamble: buildLeadAgentPreamble(context.tool, leadAgent),
    })
    return { ok: true }
  }

  const collaboratorReplies: Array<{ agent: ToolAgentInfo; reply: string }> = []

  for (const collaborator of collaborators as ToolAgentInfo[]) {
    emitPublicMessage(context, context.tool.id, leadAgent, `@${collaborator.name} 请直接告诉我你当前的进度。`, collaborator, 'agent_to_agent')

    const result = await context.manager.start(context.projectDir, context.text, context.tool.id, {
      requestedAgentName: collaborator.name,
      requestedAgentLabel: collaborator.name,
      preamble: buildCollaboratorPreamble(context.tool, leadAgent, collaborator, context.text),
    })

    const reply = normalizeCollaboratorReply(collaborator, result)
    collaboratorReplies.push({ agent: collaborator, reply })
    emitPublicMessage(context, context.tool.id, collaborator, reply, leadAgent, 'agent_reply')
  }

  await context.manager.start(context.projectDir, context.text, context.tool.id, {
    requestedAgentName: leadAgent.name,
    requestedAgentLabel: leadAgent.name,
    preamble: buildLeadSummaryPreamble(context.tool, leadAgent, context.text, collaboratorReplies),
  })

  return { ok: true }
}
```

- [ ] **Step 4: Run server tests to verify the orchestrator passes**

Run: `npm.cmd test -w server -- server/test/mention-orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/agents/orchestrator.ts server/test/mention-orchestrator.test.ts
git commit -m "feat: add mention orchestration module"
```

### Task 3: Delegate Mention Flow from `WSGateway`

**Files:**
- Modify: `server/src/ws/gateway.ts`
- Test: `server/test/mention-orchestrator.test.ts`

- [ ] **Step 1: Add a failing server test for user-request metadata on mention entry**

```ts
test('runMentionConversation triggers user-request persistence before public agent messages', async () => {
  const lifecycle: string[] = []
  const agents = [createAgent('lead'), createAgent('peer')]

  const manager = {
    isRunning: () => false,
    start: async () => ({
      ok: true,
      tool: 'claude',
      producedOutput: true,
      recoverable: false,
      assistantText: 'summary',
    }),
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
    savePublicMessage: () => lifecycle.push('public'),
    publish: () => undefined,
    onUserMessage: () => lifecycle.push('user'),
  })

  assert.deepEqual(lifecycle.slice(0, 2), ['user', 'public'])
})
```

- [ ] **Step 2: Run the focused server tests**

Run: `npm.cmd test -w server -- server/test/mention-orchestrator.test.ts`
Expected: FAIL because the orchestrator does not yet guarantee user-request lifecycle order.

- [ ] **Step 3: Refactor `server/src/ws/gateway.ts` to call the orchestrator and reuse a shared user-message helper**

```ts
import { runMentionConversation } from '../agents/orchestrator.js'
```

```ts
private persistAndBroadcastUserMessage(sessionId: string, text: string) {
  touchSession(sessionId)
  const userMessage = saveMessage(sessionId, 'user', text, {
    senderType: 'user',
    orchestrationStep: 'user_request',
  })
  const renamedSession = updateSessionNameFromFirstMessage(sessionId, text)
  if (renamedSession) {
    this.broadcast(sessionId, { type: 'session_updated', session: renamedSession })
  }
  this.broadcast(sessionId, {
    type: 'user',
    content: text,
    messageId: userMessage.id,
    senderType: 'user',
    orchestrationStep: 'user_request',
  })
}
```

```ts
if (orderedMentions.length) {
  const tool = getVibeTools().find(item => item.id === orderedMentions[0].toolId)
  if (!tool?.supportsExecution) {
    this.broadcast(session.id, {
      type: 'error',
      message: tool?.detail || 'The selected CLI tool is not currently available.',
      source: 'system',
      sourceLabel: getSourceLabel('system'),
      senderType: 'system',
    })
    return
  }

  const manager = this.getManager(session.id)
  if (manager.isRunning()) await manager.stop()

  const result = await runMentionConversation({
    sessionId: session.id,
    projectDir: session.projectDir,
    text,
    mentions: orderedMentions,
    tool,
    manager,
    onUserMessage: () => this.persistAndBroadcastUserMessage(session.id, text),
    savePublicMessage: (metadata) => {
      saveMessage(session.id, 'text', String(metadata.content || ''), metadata)
    },
    publish: (msg) => this.broadcast(session.id, msg),
  })

  if (!result.ok) {
    this.broadcast(session.id, {
      type: 'error',
      message: result.errorMessage || 'Mention conversation failed.',
      source: 'system',
      sourceLabel: getSourceLabel('system'),
      senderType: 'system',
    })
  }
  return
}
```

- [ ] **Step 4: Run server tests to verify gateway integration**

Run: `npm.cmd test -w server`
Expected: PASS, including the new mention orchestrator coverage and existing memory routing tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/ws/gateway.ts server/test/mention-orchestrator.test.ts
git commit -m "refactor: route mention conversations through orchestrator"
```

### Task 4: Add Client Failing Tests and Metadata-Aware Rendering

**Files:**
- Create: `client/test/message-source-label.test.ts`
- Create: `client/src/components/chat/sourceLabel.ts`
- Modify: `client/src/types/index.ts`
- Modify: `client/src/stores/chat.ts`
- Modify: `client/src/components/chat/MessageBubble.vue`

- [ ] **Step 1: Write the failing client tests**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useChatStore } from '../src/stores/chat.ts'
import { resolveMessageSourceLabel } from '../src/components/chat/sourceLabel.ts'

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

test('resolveMessageSourceLabel builds agent-to-agent labels from structured metadata', () => {
  const label = resolveMessageSourceLabel({
    sourceLabel: undefined,
    senderAgentName: 'peer',
    targetAgentName: 'lead',
  })

  assert.equal(label, 'peer -> lead')
})
```

- [ ] **Step 2: Run the client tests to verify they fail**

Run: `npm.cmd test -w client -- client/test/message-source-label.test.ts`
Expected: FAIL because the new test file and metadata support are not fully wired yet.

- [ ] **Step 3: Extend client types and store metadata handling**

```ts
export interface OrchestrationMetadata {
  senderType: 'user' | 'agent' | 'system'
  senderAgentId?: string
  senderAgentName?: string
  targetAgentId?: string
  targetAgentName?: string
  orchestrationStep?: 'user_request' | 'agent_to_agent' | 'agent_reply' | 'agent_to_user'
}
```

```ts
function withIncomingSourceMetadata(
  metadata: Record<string, unknown>,
  source: MessageSource | undefined,
  sourceLabel?: string,
  sourceAgent?: string,
  sourceAgentLabel?: string,
  orchestration?: Partial<OrchestrationMetadata>,
) {
  const result = source ? withSourceMetadata(metadata, source) : { ...metadata }
  if (sourceLabel) result.sourceLabel = sourceLabel
  if (sourceAgent) result.sourceAgent = sourceAgent
  if (sourceAgentLabel) result.sourceAgentLabel = sourceAgentLabel
  return { ...result, ...orchestration }
}
```

```ts
withIncomingSourceMetadata(
  {},
  msg.source,
  msg.sourceLabel,
  msg.sourceAgent,
  msg.sourceAgentLabel,
  {
    senderType: msg.senderType,
    senderAgentId: msg.senderAgentId,
    senderAgentName: msg.senderAgentName,
    targetAgentId: msg.targetAgentId,
    targetAgentName: msg.targetAgentName,
    orchestrationStep: msg.orchestrationStep,
  },
)
```

- [ ] **Step 4: Update `MessageBubble.vue` to compute source labels from metadata when available**

```ts
export function resolveMessageSourceLabel(input: {
  sourceLabel?: string
  senderAgentName?: string
  targetAgentName?: string
}) {
  if (input.sourceLabel) return input.sourceLabel
  if (input.senderAgentName && input.targetAgentName) {
    return `${input.senderAgentName} -> ${input.targetAgentName}`
  }
  return input.senderAgentName
}
```

```ts
import { resolveMessageSourceLabel } from './sourceLabel'

const props = defineProps<{
  content: string
  role: 'user' | 'assistant'
  sourceLabel?: string
  senderAgentName?: string
  targetAgentName?: string
  orchestrationStep?: 'user_request' | 'agent_to_agent' | 'agent_reply' | 'agent_to_user'
}>()

const resolvedSourceLabel = computed(() => resolveMessageSourceLabel({
  sourceLabel: props.sourceLabel,
  senderAgentName: props.senderAgentName,
  targetAgentName: props.targetAgentName,
}))
```

```vue
<div
  v-if="role === 'assistant' && resolvedSourceLabel"
  class="mb-1.5 px-1 text-[11px] font-medium text-gray-500"
>
  {{ resolvedSourceLabel }}
</div>
```

- [ ] **Step 5: Run client tests and commit**

Run: `npm.cmd test -w client`
Expected: PASS, including the existing vibe mode tests and the new message metadata coverage.

```bash
git add client/src/types/index.ts client/src/stores/chat.ts client/src/components/chat/sourceLabel.ts client/src/components/chat/MessageBubble.vue client/test/message-source-label.test.ts
git commit -m "feat: render mention orchestration metadata in chat UI"
```

### Task 5: Final Verification

**Files:**
- Verify only

- [ ] **Step 1: Run the full server test suite**

Run: `npm.cmd test -w server`
Expected: PASS with zero failures.

- [ ] **Step 2: Run the full client test suite**

Run: `npm.cmd test -w client`
Expected: PASS with zero failures.

- [ ] **Step 3: Run the server build**

Run: `npm run build -w server`
Expected: PASS

- [ ] **Step 4: Run the client build**

Run: `npm run build -w client`
Expected: PASS

- [ ] **Step 5: Commit the integrated feature**

```bash
git add server/src/agents/orchestrator.ts server/src/types/index.ts server/src/ws/gateway.ts server/test/mention-orchestrator.test.ts client/src/types/index.ts client/src/stores/chat.ts client/src/components/chat/sourceLabel.ts client/src/components/chat/MessageBubble.vue client/test/message-source-label.test.ts
git commit -m "feat: complete structured agent mention orchestration"
```

## Spec Coverage Check

- Extract orchestration from `WSGateway`: covered by Task 2 and Task 3.
- Add structured sender/target metadata: covered by Task 1, Task 3, and Task 4.
- Keep compatibility with existing `source` fields: covered by Task 1 and Task 4.
- Render agent-to-agent flows in the client: covered by Task 4.
- Add validation and regression tests: covered by Task 1, Task 2, Task 3, Task 4, and Task 5.

## Placeholder Scan

- No deferred placeholders remain.
- Each task includes file paths, commands, and code snippets.

## Type Consistency Check

- `senderType`, `senderAgentId`, `senderAgentName`, `targetAgentId`, `targetAgentName`, and `orchestrationStep` use the same names across server types, persistence metadata, and client rendering.
- The orchestrator entry point is consistently named `runMentionConversation`.
