import type Database from 'better-sqlite3'
import { v4 as uuid } from 'uuid'
import { getDb } from './database.js'
import type {
  ConversationState,
  SessionInfo,
  ToolSessionRef,
  VibeToolId,
} from '../types/index.js'

interface SessionRow {
  id: string
  name: string
  project_dir: string
  claude_session_id: string | null
  created_at: string
  last_active: string
  status: 'active' | 'archived'
}

interface ToolSessionRow {
  tool_id: VibeToolId
  native_session_id: string
  last_used_at: string
  last_status: string | null
}

interface ConversationStateRow {
  session_id: string
  canonical_summary: string
  working_memory: string
  current_goal: string
  touched_files: string
  open_questions: string
  recent_decisions: string
  last_successful_tool: VibeToolId | null
  last_summarized_seq: number
  updated_at: string
}

interface CreateSessionInput {
  name?: string
  projectDir: string
}

interface ConversationStatePatch {
  canonicalSummary?: string
  workingMemory?: string
  currentGoal?: string
  touchedFiles?: string[]
  openQuestions?: string[]
  recentDecisions?: string[]
  lastSuccessfulTool?: VibeToolId | null
  lastSummarizedSeq?: number
}

function resolveDb(database?: Database.Database) {
  return database || getDb()
}

function normalizeSessionTitle(input: string) {
  return input
    .replace(/\r?\n+/g, ' ')
    .replace(/[`*_#>\[\]\(\)~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compressSessionTitle(input: string, maxLength = 28) {
  const normalized = normalizeSessionTitle(input)
  if (!normalized) return '新会话'

  const chars = Array.from(normalized)
  if (chars.length <= maxLength) return normalized
  return `${chars.slice(0, maxLength).join('').trimEnd()}...`
}

function isDefaultSessionName(name: string) {
  return /^Session\b/.test(name) || name === '新会话'
}

function rowToSession(row: SessionRow): SessionInfo {
  return {
    id: row.id,
    name: row.name,
    projectDir: row.project_dir,
    claudeSessionId: row.claude_session_id,
    createdAt: row.created_at,
    lastActive: row.last_active,
    status: row.status,
  }
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function rowToConversationState(row: ConversationStateRow): ConversationState {
  return {
    sessionId: row.session_id,
    canonicalSummary: row.canonical_summary,
    workingMemory: row.working_memory,
    currentGoal: row.current_goal,
    touchedFiles: parseJsonArray(row.touched_files),
    openQuestions: parseJsonArray(row.open_questions),
    recentDecisions: parseJsonArray(row.recent_decisions),
    lastSuccessfulTool: row.last_successful_tool,
    lastSummarizedSeq: row.last_summarized_seq,
    updatedAt: row.updated_at,
  }
}

function createDefaultConversationState(sessionId: string, now: string): ConversationState {
  return {
    sessionId,
    canonicalSummary: '',
    workingMemory: '',
    currentGoal: '',
    touchedFiles: [],
    openQuestions: [],
    recentDecisions: [],
    lastSuccessfulTool: null,
    lastSummarizedSeq: 0,
    updatedAt: now,
  }
}

function ensureConversationState(sessionId: string, database?: Database.Database) {
  const db = resolveDb(database)
  const existing = db.prepare(`
    SELECT session_id, canonical_summary, working_memory, current_goal, touched_files, open_questions,
           recent_decisions, last_successful_tool, last_summarized_seq, updated_at
    FROM conversation_state
    WHERE session_id = ?
  `).get(sessionId) as ConversationStateRow | undefined

  if (existing) return rowToConversationState(existing)

  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO conversation_state (
      session_id, canonical_summary, working_memory, current_goal, touched_files, open_questions,
      recent_decisions, last_successful_tool, last_summarized_seq, updated_at
    )
    VALUES (?, '', '', '', '[]', '[]', '[]', NULL, 0, ?)
  `).run(sessionId, now)

  return createDefaultConversationState(sessionId, now)
}

function findFirstUserPrompt(sessionId: string, database?: Database.Database) {
  const db = resolveDb(database)
  const row = db.prepare(`
    SELECT content FROM messages
    WHERE session_id = ? AND type = 'user' AND TRIM(COALESCE(content, '')) != ''
    ORDER BY seq ASC
    LIMIT 1
  `).get(sessionId) as { content: string } | undefined

  if (!row?.content) return null
  if (row.content.trim().startsWith('/')) return null
  return row.content
}

function withBackfilledName(session: SessionInfo | null, database?: Database.Database) {
  if (!session || !isDefaultSessionName(session.name)) return session
  const firstPrompt = findFirstUserPrompt(session.id, database)
  if (!firstPrompt) return session
  return setSessionName(session.id, firstPrompt, database)
}

export function createSession(input: CreateSessionInput, database?: Database.Database): SessionInfo {
  const db = resolveDb(database)
  const id = uuid()
  const now = new Date().toISOString()
  const sessionName = compressSessionTitle(input.name || '新会话')

  const insert = db.transaction(() => {
    db.prepare(`
      INSERT INTO sessions (id, name, project_dir, claude_session_id, created_at, last_active, status)
      VALUES (?, ?, ?, NULL, ?, ?, 'active')
    `).run(id, sessionName, input.projectDir, now, now)

    db.prepare(`
      INSERT INTO conversation_state (
        session_id, canonical_summary, working_memory, current_goal, touched_files, open_questions,
        recent_decisions, last_successful_tool, last_summarized_seq, updated_at
      )
      VALUES (?, '', '', '', '[]', '[]', '[]', NULL, 0, ?)
    `).run(id, now)
  })

  insert()

  return {
    id,
    name: sessionName,
    projectDir: input.projectDir,
    claudeSessionId: null,
    createdAt: now,
    lastActive: now,
    status: 'active',
  }
}

export function getActiveSession(database?: Database.Database): SessionInfo | null {
  const db = resolveDb(database)
  const row = db.prepare(`
    SELECT * FROM sessions WHERE status = 'active' ORDER BY last_active DESC LIMIT 1
  `).get() as SessionRow | undefined
  return withBackfilledName(row ? rowToSession(row) : null, db)
}

export function getSession(id: string, database?: Database.Database): SessionInfo | null {
  const db = resolveDb(database)
  const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as SessionRow | undefined
  return withBackfilledName(row ? rowToSession(row) : null, db)
}

export function listSessions(database?: Database.Database): SessionInfo[] {
  const db = resolveDb(database)
  const rows = db.prepare(`
    SELECT * FROM sessions ORDER BY last_active DESC LIMIT 50
  `).all() as SessionRow[]
  return rows.map(row => withBackfilledName(rowToSession(row), db)!).filter(Boolean)
}

export function touchSession(id: string, database?: Database.Database) {
  const db = resolveDb(database)
  db.prepare(`UPDATE sessions SET last_active = ? WHERE id = ?`)
    .run(new Date().toISOString(), id)
}

export function getToolSessionRefs(sessionId: string, database?: Database.Database): ToolSessionRef[] {
  const db = resolveDb(database)
  const rows = db.prepare(`
    SELECT tool_id, native_session_id, last_used_at, last_status
    FROM tool_sessions
    WHERE session_id = ?
    ORDER BY last_used_at DESC
  `).all(sessionId) as ToolSessionRow[]

  return rows.map(row => ({
    toolId: row.tool_id,
    nativeSessionId: row.native_session_id,
    lastUsedAt: row.last_used_at,
    lastStatus: row.last_status,
  }))
}

export function getToolSessionMap(
  sessionId: string,
  database?: Database.Database,
): Partial<Record<VibeToolId, string>> {
  const refs = getToolSessionRefs(sessionId, database)
  return refs.reduce<Partial<Record<VibeToolId, string>>>((acc, ref) => {
    acc[ref.toolId] = ref.nativeSessionId
    return acc
  }, {})
}

export function setToolSessionId(
  sessionId: string,
  toolId: VibeToolId,
  nativeSessionId: string,
  lastStatus: string | null = null,
  database?: Database.Database,
) {
  const db = resolveDb(database)
  const now = new Date().toISOString()

  const save = db.transaction(() => {
    db.prepare(`
      INSERT INTO tool_sessions (session_id, tool_id, native_session_id, last_used_at, last_status)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id, tool_id) DO UPDATE SET
        native_session_id = excluded.native_session_id,
        last_used_at = excluded.last_used_at,
        last_status = excluded.last_status
    `).run(sessionId, toolId, nativeSessionId, now, lastStatus)

    if (toolId === 'claude') {
      db.prepare(`UPDATE sessions SET claude_session_id = ? WHERE id = ?`)
        .run(nativeSessionId, sessionId)
    }
  })

  save()
}

export function setClaudeSessionId(id: string, claudeSessionId: string, database?: Database.Database) {
  setToolSessionId(id, 'claude', claudeSessionId, null, database)
}

export function getConversationState(sessionId: string, database?: Database.Database): ConversationState {
  return ensureConversationState(sessionId, database)
}

export function upsertConversationState(
  sessionId: string,
  patch: ConversationStatePatch,
  database?: Database.Database,
): ConversationState {
  const db = resolveDb(database)
  const current = ensureConversationState(sessionId, db)
  const next: ConversationState = {
    sessionId,
    canonicalSummary: patch.canonicalSummary ?? current.canonicalSummary,
    workingMemory: patch.workingMemory ?? current.workingMemory,
    currentGoal: patch.currentGoal ?? current.currentGoal,
    touchedFiles: patch.touchedFiles ?? current.touchedFiles,
    openQuestions: patch.openQuestions ?? current.openQuestions,
    recentDecisions: patch.recentDecisions ?? current.recentDecisions,
    lastSuccessfulTool: patch.lastSuccessfulTool ?? current.lastSuccessfulTool,
    lastSummarizedSeq: patch.lastSummarizedSeq ?? current.lastSummarizedSeq,
    updatedAt: new Date().toISOString(),
  }

  db.prepare(`
    INSERT INTO conversation_state (
      session_id, canonical_summary, working_memory, current_goal, touched_files, open_questions,
      recent_decisions, last_successful_tool, last_summarized_seq, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      canonical_summary = excluded.canonical_summary,
      working_memory = excluded.working_memory,
      current_goal = excluded.current_goal,
      touched_files = excluded.touched_files,
      open_questions = excluded.open_questions,
      recent_decisions = excluded.recent_decisions,
      last_successful_tool = excluded.last_successful_tool,
      last_summarized_seq = excluded.last_summarized_seq,
      updated_at = excluded.updated_at
  `).run(
    sessionId,
    next.canonicalSummary,
    next.workingMemory,
    next.currentGoal,
    JSON.stringify(next.touchedFiles),
    JSON.stringify(next.openQuestions),
    JSON.stringify(next.recentDecisions),
    next.lastSuccessfulTool,
    next.lastSummarizedSeq,
    next.updatedAt,
  )

  return next
}

export function setSessionName(id: string, name: string, database?: Database.Database) {
  const db = resolveDb(database)
  const sessionName = compressSessionTitle(name)
  db.prepare(`UPDATE sessions SET name = ? WHERE id = ?`)
    .run(sessionName, id)
  return getSession(id, db)
}

export function updateSessionNameFromFirstMessage(id: string, firstMessage: string, database?: Database.Database) {
  const session = getSession(id, database)
  if (!session || !isDefaultSessionName(session.name)) return session
  if (firstMessage.trim().startsWith('/')) return session
  return setSessionName(id, firstMessage, database)
}

export function archiveSession(id: string, database?: Database.Database) {
  const db = resolveDb(database)
  db.prepare(`UPDATE sessions SET status = 'archived' WHERE id = ?`).run(id)
}

export function deleteSession(id: string, database?: Database.Database): boolean {
  const db = resolveDb(database)
  const remove = db.transaction((sessionId: string) => {
    db.prepare(`DELETE FROM tool_sessions WHERE session_id = ?`).run(sessionId)
    db.prepare(`DELETE FROM conversation_state WHERE session_id = ?`).run(sessionId)
    db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId)
    return db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId)
  })
  const result = remove(id) as { changes: number }
  return result.changes > 0
}
