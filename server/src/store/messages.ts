import type Database from 'better-sqlite3'
import { v4 as uuid } from 'uuid'
import { getDb } from './database.js'
import type { Message, MessagePage, MessageType } from '../types/index.js'

interface MessageRow {
  id: string
  session_id: string
  type: MessageType
  content: string | null
  metadata: string
  seq: number
  created_at: string
}

export const DEFAULT_MESSAGE_WINDOW = 80

function resolveDb(database?: Database.Database) {
  return database || getDb()
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    content: row.content || '',
    metadata: JSON.parse(row.metadata || '{}'),
    seq: row.seq,
    createdAt: row.created_at,
  }
}

function buildMessagePage(rows: MessageRow[], hasMore: boolean): MessagePage {
  const messages = rows.map(rowToMessage)
  return {
    messages,
    hasMore,
    oldestSeq: messages[0]?.seq ?? null,
  }
}

export function saveMessage(
  sessionId: string,
  type: MessageType,
  content: string,
  metadata: Record<string, unknown> = {},
  messageId = uuid(),
  database?: Database.Database,
): Message {
  const db = resolveDb(database)
  const id = messageId
  const now = new Date().toISOString()

  const maxSeq = db.prepare(`
    SELECT COALESCE(MAX(seq), -1) as max_seq FROM messages WHERE session_id = ?
  `).get(sessionId) as { max_seq: number }
  const seq = maxSeq.max_seq + 1

  db.prepare(`
    INSERT INTO messages (id, session_id, type, content, metadata, seq, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, type, content, JSON.stringify(metadata), seq, now)

  return {
    id,
    sessionId,
    type,
    content,
    metadata,
    seq,
    createdAt: now,
  }
}

export function appendMessageContent(id: string, chunk: string) {
  if (!chunk) return

  const db = resolveDb()
  db.prepare(`
    UPDATE messages
    SET content = COALESCE(content, '') || ?
    WHERE id = ?
  `).run(chunk, id)
}

export function getMessages(sessionId: string, database?: Database.Database): Message[] {
  const db = resolveDb(database)
  const rows = db.prepare(`
    SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC
  `).all(sessionId) as MessageRow[]
  return rows.map(rowToMessage)
}

export function getRecentMessagesWindow(
  sessionId: string,
  limit = DEFAULT_MESSAGE_WINDOW,
  database?: Database.Database,
): MessagePage {
  const db = resolveDb(database)
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT * FROM messages WHERE session_id = ? ORDER BY seq DESC LIMIT ?
    )
    ORDER BY seq ASC
  `).all(sessionId, limit) as MessageRow[]

  const oldestRow = rows[0]
  let hasMore = false
  if (oldestRow) {
    const previous = db.prepare(`
      SELECT 1 FROM messages WHERE session_id = ? AND seq < ? LIMIT 1
    `).get(sessionId, oldestRow.seq) as { 1: number } | undefined
    hasMore = !!previous
  }

  return buildMessagePage(rows, hasMore)
}

export function getMessagesBefore(
  sessionId: string,
  beforeSeq: number,
  limit = DEFAULT_MESSAGE_WINDOW,
  database?: Database.Database,
): MessagePage {
  const db = resolveDb(database)
  const rowsDesc = db.prepare(`
    SELECT * FROM messages
    WHERE session_id = ? AND seq < ?
    ORDER BY seq DESC
    LIMIT ?
  `).all(sessionId, beforeSeq, limit) as MessageRow[]

  const rows = [...rowsDesc].reverse()
  const oldestRow = rows[0]
  let hasMore = false
  if (oldestRow) {
    const previous = db.prepare(`
      SELECT 1 FROM messages WHERE session_id = ? AND seq < ? LIMIT 1
    `).get(sessionId, oldestRow.seq) as { 1: number } | undefined
    hasMore = !!previous
  }

  return buildMessagePage(rows, hasMore)
}
