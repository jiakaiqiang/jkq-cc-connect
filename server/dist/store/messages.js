import { v4 as uuid } from 'uuid';
import { getDb } from './database.js';
export const DEFAULT_MESSAGE_WINDOW = 80;
function resolveDb(database) {
    return database || getDb();
}
function rowToMessage(row) {
    return {
        id: row.id,
        sessionId: row.session_id,
        type: row.type,
        content: row.content || '',
        metadata: JSON.parse(row.metadata || '{}'),
        seq: row.seq,
        createdAt: row.created_at,
    };
}
function buildMessagePage(rows, hasMore) {
    const messages = rows.map(rowToMessage);
    return {
        messages,
        hasMore,
        oldestSeq: messages[0]?.seq ?? null,
    };
}
export function saveMessage(sessionId, type, content, metadata = {}, messageId = uuid(), database) {
    const db = resolveDb(database);
    const id = messageId;
    const now = new Date().toISOString();
    const maxSeq = db.prepare(`
    SELECT COALESCE(MAX(seq), -1) as max_seq FROM messages WHERE session_id = ?
  `).get(sessionId);
    const seq = maxSeq.max_seq + 1;
    db.prepare(`
    INSERT INTO messages (id, session_id, type, content, metadata, seq, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, type, content, JSON.stringify(metadata), seq, now);
    return {
        id,
        sessionId,
        type,
        content,
        metadata,
        seq,
        createdAt: now,
    };
}
export function appendMessageContent(id, chunk) {
    if (!chunk)
        return;
    const db = resolveDb();
    db.prepare(`
    UPDATE messages
    SET content = COALESCE(content, '') || ?
    WHERE id = ?
  `).run(chunk, id);
}
export function getMessages(sessionId, database) {
    const db = resolveDb(database);
    const rows = db.prepare(`
    SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC
  `).all(sessionId);
    return rows.map(rowToMessage);
}
export function getRecentMessagesWindow(sessionId, limit = DEFAULT_MESSAGE_WINDOW, database) {
    const db = resolveDb(database);
    const rows = db.prepare(`
    SELECT * FROM (
      SELECT * FROM messages WHERE session_id = ? ORDER BY seq DESC LIMIT ?
    )
    ORDER BY seq ASC
  `).all(sessionId, limit);
    const oldestRow = rows[0];
    let hasMore = false;
    if (oldestRow) {
        const previous = db.prepare(`
      SELECT 1 FROM messages WHERE session_id = ? AND seq < ? LIMIT 1
    `).get(sessionId, oldestRow.seq);
        hasMore = !!previous;
    }
    return buildMessagePage(rows, hasMore);
}
export function getMessagesBefore(sessionId, beforeSeq, limit = DEFAULT_MESSAGE_WINDOW, database) {
    const db = resolveDb(database);
    const rowsDesc = db.prepare(`
    SELECT * FROM messages
    WHERE session_id = ? AND seq < ?
    ORDER BY seq DESC
    LIMIT ?
  `).all(sessionId, beforeSeq, limit);
    const rows = [...rowsDesc].reverse();
    const oldestRow = rows[0];
    let hasMore = false;
    if (oldestRow) {
        const previous = db.prepare(`
      SELECT 1 FROM messages WHERE session_id = ? AND seq < ? LIMIT 1
    `).get(sessionId, oldestRow.seq);
        hasMore = !!previous;
    }
    return buildMessagePage(rows, hasMore);
}
//# sourceMappingURL=messages.js.map