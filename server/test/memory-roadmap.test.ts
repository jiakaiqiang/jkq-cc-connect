import test from 'node:test'
import assert from 'node:assert/strict'

import Database from 'better-sqlite3'
import { CCManager } from '../src/cc/manager.ts'
import { buildExecutionInput } from '../src/cc/context.ts'
import { applyMigrations } from '../src/store/database.ts'
import { refreshConversationStateFromRecentHistory, summarizeConversationState } from '../src/store/conversation.ts'
import { getMessagesBefore, getRecentMessagesWindow, saveMessage } from '../src/store/messages.ts'
import {
  createSession,
  getConversationState,
  getToolSessionMap,
  setToolSessionId,
  upsertConversationState,
} from '../src/store/sessions.ts'
import { getFallbackTools, planToolRoute } from '../src/tools/vibe.ts'
import type { ConversationState, Message, ToolExecutionMode, VibeToolInfo, VibeToolState } from '../src/types/index.ts'

function createTool(
  id: VibeToolInfo['id'],
  overrides: Partial<VibeToolInfo> = {},
): VibeToolInfo {
  return {
    id,
    label: id[0].toUpperCase() + id.slice(1),
    command: id,
    version: 'test',
    installed: true,
    configured: true,
    authenticated: true,
    state: 'ready' satisfies VibeToolState,
    statusText: '可用',
    detail: `${id} is available`,
    supportsExecution: true,
    supportsParallel: false,
    agentCount: 0,
    agents: [],
    ...overrides,
  }
}

function createMemoryDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

function createConversationState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    sessionId: 's1',
    canonicalSummary: '',
    workingMemory: '',
    currentGoal: '',
    touchedFiles: [],
    openQuestions: [],
    recentDecisions: [],
    lastSuccessfulTool: null,
    lastSummarizedSeq: 0,
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    sessionId: 's1',
    type: 'text',
    content: '',
    metadata: {},
    seq: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

test('getFallbackTools excludes the failed tool and keeps only executable tools', () => {
  const tools: VibeToolInfo[] = [
    createTool('claude'),
    createTool('codex', {
      supportsExecution: false,
      configured: false,
      authenticated: false,
      state: 'limited',
      statusText: '需登录',
    }),
    createTool('opencode'),
  ]

  const result = getFallbackTools('please review this implementation', 'claude', tools)
  assert.deepEqual(result, ['opencode'])
})

test('planToolRoute honors an explicitly requested executable mode', () => {
  const tools: VibeToolInfo[] = [
    createTool('claude'),
    createTool('codex'),
    createTool('opencode'),
  ]

  const route = planToolRoute('帮我审查当前改动', 'codex' satisfies ToolExecutionMode, tools)
  assert.equal(route.mode, 'codex')
  assert.deepEqual(route.selectedTools, ['codex'])
  assert.equal(route.blockedReason, undefined)
})

test('planToolRoute blocks an explicitly requested unavailable mode', () => {
  const tools: VibeToolInfo[] = [
    createTool('claude'),
    createTool('codex', {
      supportsExecution: false,
      configured: false,
      authenticated: false,
      state: 'limited',
      statusText: '需登录',
      detail: 'Codex CLI 已安装，但未检测到本地登录凭证。',
    }),
    createTool('opencode'),
  ]

  const route = planToolRoute('帮我审查当前改动', 'codex' satisfies ToolExecutionMode, tools)
  assert.equal(route.mode, 'codex')
  assert.deepEqual(route.selectedTools, [])
  assert.match(route.blockedReason || '', /登录|不可用/)
})

test('applyMigrations creates tool_sessions and layered conversation_state columns', () => {
  const db = createMemoryDb()
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('tool_sessions', 'conversation_state')
    ORDER BY name
  `).all() as Array<{ name: string }>

  const conversationColumns = db.prepare(`PRAGMA table_info(conversation_state)`).all() as Array<{ name: string }>

  assert.deepEqual(tables.map(row => row.name), ['conversation_state', 'tool_sessions'])
  assert.ok(conversationColumns.some(column => column.name === 'working_memory'))
  assert.ok(conversationColumns.some(column => column.name === 'recent_decisions'))
})

test('session store persists tool native session ids for all CLI tools', () => {
  const db = createMemoryDb()
  const session = createSession({ projectDir: 'D:/demo/jkq-cc-connect' }, db)

  setToolSessionId(session.id, 'claude', 'claude-native-1', 'idle', db)
  setToolSessionId(session.id, 'codex', 'codex-native-1', 'thinking', db)
  setToolSessionId(session.id, 'opencode', 'opencode-native-1', 'executing', db)

  assert.deepEqual(getToolSessionMap(session.id, db), {
    claude: 'claude-native-1',
    codex: 'codex-native-1',
    opencode: 'opencode-native-1',
  })
})

test('conversation_state stores canonical summary, working memory, and recent decisions', () => {
  const db = createMemoryDb()
  const session = createSession({ projectDir: 'D:/demo/jkq-cc-connect' }, db)

  const initial = getConversationState(session.id, db)
  assert.equal(initial.lastSuccessfulTool, null)
  assert.equal(initial.canonicalSummary, '')
  assert.equal(initial.workingMemory, '')
  assert.deepEqual(initial.recentDecisions, [])

  const updated = upsertConversationState(session.id, {
    canonicalSummary: '用户正在实现 memory 与上下文复用。',
    workingMemory: '当前正在处理 tool_sessions 与 sticky routing。',
    currentGoal: '先落 tool_sessions 和 sticky routing',
    touchedFiles: ['server/src/ws/gateway.ts', 'server/src/store/sessions.ts'],
    openQuestions: ['摘要触发阈值'],
    recentDecisions: ['已完成 tool session 持久化'],
    lastSuccessfulTool: 'claude',
    lastSummarizedSeq: 18,
  }, db)

  assert.equal(updated.lastSuccessfulTool, 'claude')
  assert.equal(updated.workingMemory, '当前正在处理 tool_sessions 与 sticky routing。')
  assert.equal(updated.currentGoal, '先落 tool_sessions 和 sticky routing')
  assert.deepEqual(updated.touchedFiles, ['server/src/ws/gateway.ts', 'server/src/store/sessions.ts'])
  assert.deepEqual(updated.openQuestions, ['摘要触发阈值'])
  assert.deepEqual(updated.recentDecisions, ['已完成 tool session 持久化'])
  assert.equal(updated.lastSummarizedSeq, 18)
})

test('manager hydration restores persisted native session ids for Claude, Codex, and OpenCode', () => {
  const manager = new CCManager()
  manager.hydrateToolSessions({
    claude: 'claude-session-1',
    codex: 'codex-session-1',
    opencode: 'opencode-session-1',
  })

  assert.deepEqual(manager.getToolSessionSnapshot(), {
    claude: 'claude-session-1',
    codex: 'codex-session-1',
    opencode: 'opencode-session-1',
  })
})

test('auto routing prefers the last successful executable tool before prompt keyword scoring', () => {
  const tools: VibeToolInfo[] = [
    createTool('claude'),
    createTool('codex'),
    createTool('opencode'),
  ]

  const route = planToolRoute('请帮我 review 当前改动', 'auto', tools, {
    lastSuccessfulTool: 'claude',
    availableSessionTools: ['claude'],
  })

  assert.equal(route.mode, 'auto')
  assert.deepEqual(route.selectedTools, ['claude'])
})

test('cross-tool handoff uses working memory, summary, and recent window instead of replaying the full transcript', () => {
  const input = buildExecutionInput({
    text: '继续修复自动切换问题',
    targetTool: 'codex',
    toolHasNativeSession: true,
    lastSuccessfulTool: 'claude',
    handoffFromTool: 'claude',
    conversationState: createConversationState({
      canonicalSummary: '已经完成 tool session 持久化，正在补跨工具 handoff。',
      workingMemory: '当前在处理 handoff 与分页。',
      currentGoal: '继续完成分页与 handoff',
      recentDecisions: ['已完成 tool session 持久化'],
      lastSuccessfulTool: 'claude',
      lastSummarizedSeq: 12,
    }),
    recentMessages: [
      createMessage({ id: 'm1', type: 'user', content: '先把 tool_sessions 落库', seq: 1 }),
      createMessage({ id: 'm2', type: 'text', content: '已经完成持久化，接下来准备做 handoff。', metadata: { sourceLabel: 'Claude' }, seq: 2 }),
    ],
  })

  assert.match(input, /\[CONTEXT HANDOFF\]/)
  assert.match(input, /工作记忆/)
  assert.match(input, /会话摘要/)
  assert.match(input, /近期决策/)
  assert.match(input, /最近对话/)
  assert.match(input, /继续修复自动切换问题/)
})

test('session history loads a recent window and fetches older pages through pagination', () => {
  const db = createMemoryDb()
  const session = createSession({ projectDir: 'D:/demo/jkq-cc-connect' }, db)

  for (let index = 0; index < 6; index += 1) {
    saveMessage(session.id, index % 2 === 0 ? 'user' : 'text', `message-${index}`, {}, undefined, db)
  }

  const recent = getRecentMessagesWindow(session.id, 3, db)
  assert.equal(recent.hasMore, true)
  assert.deepEqual(recent.messages.map(message => message.content), ['message-3', 'message-4', 'message-5'])
  assert.equal(recent.oldestSeq, 3)

  const older = getMessagesBefore(session.id, recent.oldestSeq!, 3, db)
  assert.equal(older.hasMore, false)
  assert.deepEqual(older.messages.map(message => message.content), ['message-0', 'message-1', 'message-2'])
  assert.equal(older.oldestSeq, 0)
})

test('conversation summary extracts working memory, touched files, open questions, and recent decisions from message history', () => {
  const patch = summarizeConversationState([
    createMessage({
      id: 'm1',
      type: 'user',
      content: '下一步怎么处理 server/src/ws/gateway.ts 里的自动切换？',
      seq: 1,
    }),
    createMessage({
      id: 'm2',
      type: 'text',
      content: '我已经修改了 server/src/store/sessions.ts，并准备继续处理 gateway。',
      metadata: { sourceLabel: 'Claude' },
      seq: 2,
    }),
  ], createConversationState({
    currentGoal: '完成自动切换与 memory 管理',
    lastSuccessfulTool: 'claude',
  }))

  assert.match(patch.canonicalSummary, /当前目标/)
  assert.match(patch.canonicalSummary, /最近成功工具：Claude/)
  assert.match(patch.workingMemory, /当前任务/)
  assert.match(patch.workingMemory, /近期决策/)
  assert.deepEqual(patch.touchedFiles, ['server/src/ws/gateway.ts', 'server/src/store/sessions.ts'])
  assert.deepEqual(patch.openQuestions, ['下一步怎么处理 server/src/ws/gateway.ts 里的自动切换？'])
  assert.deepEqual(patch.recentDecisions, ['我已经修改了 server/src/store/sessions.ts，并准备继续处理 gateway。'])
  assert.equal(patch.lastSummarizedSeq, 2)
})

test('refreshConversationStateFromRecentHistory persists layered memory fields back into conversation_state', () => {
  const db = createMemoryDb()
  const session = createSession({ projectDir: 'D:/demo/jkq-cc-connect' }, db)

  upsertConversationState(session.id, {
    currentGoal: '继续完成自动摘要更新',
    lastSuccessfulTool: 'codex',
  }, db)

  saveMessage(session.id, 'user', '这个问题还需要确认吗？', {}, undefined, db)
  saveMessage(session.id, 'text', '我刚刚改了 server/src/store/conversation.ts。', { sourceLabel: 'Codex' }, undefined, db)

  const refreshed = refreshConversationStateFromRecentHistory(session.id, db)

  assert.equal(refreshed.lastSuccessfulTool, 'codex')
  assert.match(refreshed.canonicalSummary, /最近成功工具：Codex/)
  assert.match(refreshed.workingMemory, /当前任务/)
  assert.deepEqual(refreshed.touchedFiles, ['server/src/store/conversation.ts'])
  assert.deepEqual(refreshed.openQuestions, ['这个问题还需要确认吗？'])
  assert.deepEqual(refreshed.recentDecisions, ['我刚刚改了 server/src/store/conversation.ts。'])
})

test('conversation_state query returns layered memory fields for UI consumption', () => {
  const db = createMemoryDb()
  const session = createSession({ projectDir: 'D:/demo/jkq-cc-connect' }, db)

  upsertConversationState(session.id, {
    canonicalSummary: '这是会话摘要',
    workingMemory: '这是工作记忆',
    currentGoal: '完善 memory 可视化',
    touchedFiles: ['client/src/views/ChatView.vue'],
    openQuestions: ['是否需要单独的 memory 页面？'],
    recentDecisions: ['先在聊天页展示 memory 面板'],
    lastSuccessfulTool: 'claude',
  }, db)

  const state = getConversationState(session.id, db)
  assert.equal(state.canonicalSummary, '这是会话摘要')
  assert.equal(state.workingMemory, '这是工作记忆')
  assert.deepEqual(state.touchedFiles, ['client/src/views/ChatView.vue'])
  assert.deepEqual(state.openQuestions, ['是否需要单独的 memory 页面？'])
  assert.deepEqual(state.recentDecisions, ['先在聊天页展示 memory 面板'])
})
