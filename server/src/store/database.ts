import Database from 'better-sqlite3'
import { getDbPath } from '../config.js'
import { logger } from '../utils/logger.js'

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(getDbPath())
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    logger.info('Database connected')
  }
  return db
}

export function applyMigrations(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_dir TEXT NOT NULL,
      claude_session_id TEXT,
      created_at TEXT NOT NULL,
      last_active TEXT NOT NULL,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      type TEXT NOT NULL,
      content TEXT,
      metadata TEXT DEFAULT '{}',
      seq INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);

    CREATE TABLE IF NOT EXISTS tool_sessions (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      tool_id TEXT NOT NULL,
      native_session_id TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      last_status TEXT,
      PRIMARY KEY (session_id, tool_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tool_sessions_last_used
      ON tool_sessions(session_id, last_used_at DESC);

    CREATE TABLE IF NOT EXISTS conversation_state (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      canonical_summary TEXT NOT NULL DEFAULT '',
      working_memory TEXT NOT NULL DEFAULT '',
      current_goal TEXT NOT NULL DEFAULT '',
      touched_files TEXT NOT NULL DEFAULT '[]',
      open_questions TEXT NOT NULL DEFAULT '[]',
      recent_decisions TEXT NOT NULL DEFAULT '[]',
      last_successful_tool TEXT,
      last_summarized_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      password_hash TEXT NOT NULL
    );
  `)

  const sessionColumns = d.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>
  if (!sessionColumns.some(column => column.name === 'claude_session_id')) {
    d.exec(`ALTER TABLE sessions ADD COLUMN claude_session_id TEXT`)
  }

  const conversationColumns = d.prepare(`PRAGMA table_info(conversation_state)`).all() as Array<{ name: string }>
  if (!conversationColumns.some(column => column.name === 'working_memory')) {
    d.exec(`ALTER TABLE conversation_state ADD COLUMN working_memory TEXT NOT NULL DEFAULT ''`)
  }
  if (!conversationColumns.some(column => column.name === 'recent_decisions')) {
    d.exec(`ALTER TABLE conversation_state ADD COLUMN recent_decisions TEXT NOT NULL DEFAULT '[]'`)
  }
}

export function initDb() {
  const d = getDb()
  applyMigrations(d)
  logger.info('Database initialized')
}
