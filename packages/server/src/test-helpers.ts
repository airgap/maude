import { Database } from 'bun:sqlite';

/**
 * Create an in-memory SQLite database with the same schema as production.
 */
export function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Conversation',
      model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
      system_prompt TEXT,
      project_path TEXT,
      plan_mode INTEGER NOT NULL DEFAULT 0,
      plan_file TEXT,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      permission_mode TEXT DEFAULT 'safe',
      effort TEXT,
      max_budget_usd REAL,
      max_turns INTEGER,
      allowed_tools TEXT,
      disallowed_tools TEXT,
      cli_session_id TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      token_count INTEGER,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      subject TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      active_form TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      owner TEXT,
      blocks TEXT NOT NULL DEFAULT '[]',
      blocked_by TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      name TEXT PRIMARY KEY,
      transport TEXT NOT NULL DEFAULT 'stdio',
      command TEXT,
      args TEXT DEFAULT '[]',
      url TEXT,
      env TEXT DEFAULT '{}',
      scope TEXT NOT NULL DEFAULT 'project',
      status TEXT NOT NULL DEFAULT 'disconnected'
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, timestamp)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_conv ON tasks(conversation_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');

  return db;
}
