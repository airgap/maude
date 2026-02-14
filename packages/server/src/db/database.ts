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

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      last_opened INTEGER NOT NULL,
      settings TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS git_snapshots (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      conversation_id TEXT,
      head_sha TEXT NOT NULL,
      stash_sha TEXT,
      reason TEXT NOT NULL DEFAULT 'pre-agent',
      has_changes INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_memories (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'convention',
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      confidence REAL NOT NULL DEFAULT 1.0,
      times_seen INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON tasks(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_projects_last_opened ON projects(last_opened DESC);
    CREATE INDEX IF NOT EXISTS idx_git_snapshots_path ON git_snapshots(project_path, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_memories_path ON project_memories(project_path);
    CREATE INDEX IF NOT EXISTS idx_project_memories_category ON project_memories(project_path, category);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prds (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      branch_name TEXT,
      quality_checks TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prd_stories (
      id TEXT PRIMARY KEY,
      prd_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      acceptance_criteria TEXT NOT NULL DEFAULT '[]',
      priority TEXT NOT NULL DEFAULT 'medium',
      depends_on TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      task_id TEXT,
      agent_id TEXT,
      conversation_id TEXT,
      commit_sha TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      learnings TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (prd_id) REFERENCES prds(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS loops (
      id TEXT PRIMARY KEY,
      prd_id TEXT NOT NULL,
      project_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      config TEXT NOT NULL DEFAULT '{}',
      current_iteration INTEGER NOT NULL DEFAULT 0,
      current_story_id TEXT,
      current_agent_id TEXT,
      started_at INTEGER NOT NULL,
      paused_at INTEGER,
      completed_at INTEGER,
      total_stories_completed INTEGER NOT NULL DEFAULT 0,
      total_stories_failed INTEGER NOT NULL DEFAULT 0,
      total_iterations INTEGER NOT NULL DEFAULT 0,
      iteration_log TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (prd_id) REFERENCES prds(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS story_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'feature',
      title_template TEXT NOT NULL DEFAULT '',
      description_template TEXT NOT NULL DEFAULT '',
      acceptance_criteria_templates TEXT NOT NULL DEFAULT '[]',
      priority TEXT NOT NULL DEFAULT 'medium',
      tags TEXT NOT NULL DEFAULT '[]',
      is_built_in INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_prds_project_path ON prds(project_path);
    CREATE INDEX IF NOT EXISTS idx_prd_stories_prd ON prd_stories(prd_id);
    CREATE INDEX IF NOT EXISTS idx_loops_prd ON loops(prd_id);
    CREATE INDEX IF NOT EXISTS idx_loops_status ON loops(status);
    CREATE INDEX IF NOT EXISTS idx_story_templates_category ON story_templates(category);
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
    `ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id)`,
    `ALTER TABLE conversations ADD COLUMN user_id TEXT`,
    `ALTER TABLE prd_stories ADD COLUMN estimate TEXT`,
    `ALTER TABLE prd_stories ADD COLUMN dependency_reasons TEXT NOT NULL DEFAULT '{}'`,
  ];
  for (const sql of alterColumns) {
    try {
      db.exec(sql);
    } catch {
      /* column already exists */
    }
  }
}
