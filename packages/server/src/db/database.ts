import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const DB_PATH = join(homedir(), '.maude', 'maude.db');

let db: Database;

export function getDb(): Database {
  if (!db) {
    // Ensure directory exists
    const dir = join(homedir(), '.maude');
    mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA foreign_keys=ON');
  }
  return db;
}

export function initDatabase(): void {
  const db = getDb();

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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      token_count INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      active_form TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      owner TEXT,
      blocks TEXT NOT NULL DEFAULT '[]',
      blocked_by TEXT NOT NULL DEFAULT '[]',
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      name TEXT PRIMARY KEY,
      transport TEXT NOT NULL,
      command TEXT,
      args TEXT,
      url TEXT,
      env TEXT,
      scope TEXT NOT NULL DEFAULT 'local',
      status TEXT NOT NULL DEFAULT 'disconnected'
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON tasks(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `);

  // Migrate: add new conversation columns (safe ALTER TABLE — no-ops if already exist)
  const alterColumns = [
    `ALTER TABLE conversations ADD COLUMN permission_mode TEXT DEFAULT 'default'`,
    `ALTER TABLE conversations ADD COLUMN effort TEXT DEFAULT 'high'`,
    `ALTER TABLE conversations ADD COLUMN max_budget_usd REAL`,
    `ALTER TABLE conversations ADD COLUMN max_turns INTEGER`,
    `ALTER TABLE conversations ADD COLUMN allowed_tools TEXT`,
    `ALTER TABLE conversations ADD COLUMN disallowed_tools TEXT`,
    `ALTER TABLE conversations ADD COLUMN cli_session_id TEXT`,
  ];
  for (const sql of alterColumns) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }
}
