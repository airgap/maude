import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import { nanoid } from 'nanoid';

const DB_PATH = Bun.env.E_DB_PATH || join(homedir(), '.e', 'e.db');

let db: Database;

export function getDb(): Database {
  if (!db) {
    if (DB_PATH !== ':memory:') {
      // Ensure directory exists for file-based databases
      const dir = join(homedir(), '.e');
      mkdirSync(dir, { recursive: true });
    }
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
      workspace_path TEXT,
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

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      last_opened INTEGER NOT NULL,
      settings TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS git_snapshots (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      conversation_id TEXT,
      head_sha TEXT NOT NULL,
      stash_sha TEXT,
      reason TEXT NOT NULL DEFAULT 'pre-agent',
      has_changes INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_memories (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_workspaces_last_opened ON workspaces(last_opened DESC);

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
      workspace_path TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      branch_name TEXT,
      quality_checks TEXT NOT NULL DEFAULT '[]',
      external_ref TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prd_stories (
      id TEXT PRIMARY KEY,
      prd_id TEXT,
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
      workspace_path TEXT,
      external_ref TEXT,
      external_status TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (prd_id) REFERENCES prds(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS loops (
      id TEXT PRIMARY KEY,
      prd_id TEXT,
      workspace_path TEXT NOT NULL,
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
      last_heartbeat INTEGER,
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

    CREATE INDEX IF NOT EXISTS idx_prd_stories_prd ON prd_stories(prd_id);
    CREATE INDEX IF NOT EXISTS idx_loops_prd ON loops(prd_id);
    CREATE INDEX IF NOT EXISTS idx_loops_status ON loops(status);
    CREATE INDEX IF NOT EXISTS idx_story_templates_category ON story_templates(category);

    CREATE TABLE IF NOT EXISTS rules_metadata (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_metadata_path ON rules_metadata(workspace_path, file_path);
    CREATE INDEX IF NOT EXISTS idx_rules_metadata_mode ON rules_metadata(workspace_path, mode);

    CREATE TABLE IF NOT EXISTS agent_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      permission_mode TEXT NOT NULL DEFAULT 'unrestricted',
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      disallowed_tools TEXT NOT NULL DEFAULT '[]',
      system_prompt TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_profiles_name ON agent_profiles(name);

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT,
      type TEXT NOT NULL DEFAULT 'plan',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON artifacts(conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_pinned ON artifacts(conversation_id, pinned);

    CREATE TABLE IF NOT EXISTS agent_notes (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      conversation_id TEXT,
      story_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      status TEXT NOT NULL DEFAULT 'unread',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_notes_workspace ON agent_notes(workspace_path, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_notes_status ON agent_notes(workspace_path, status);
    CREATE INDEX IF NOT EXISTS idx_agent_notes_story ON agent_notes(story_id);

    CREATE TABLE IF NOT EXISTS commentary_history (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      conversation_id TEXT,
      text TEXT NOT NULL,
      personality TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

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
    `ALTER TABLE conversations ADD COLUMN compact_summary TEXT`,
    `ALTER TABLE conversations ADD COLUMN workspace_id TEXT REFERENCES workspaces(id)`,
    `ALTER TABLE conversations ADD COLUMN user_id TEXT`,
    `ALTER TABLE prd_stories ADD COLUMN estimate TEXT`,
    `ALTER TABLE prd_stories ADD COLUMN dependency_reasons TEXT NOT NULL DEFAULT '{}'`,
    `ALTER TABLE prd_stories ADD COLUMN priority_recommendation TEXT`,
    `ALTER TABLE prd_stories ADD COLUMN research_only INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE git_snapshots ADD COLUMN message_id TEXT`,
    `ALTER TABLE conversations ADD COLUMN profile_id TEXT`,
    `ALTER TABLE commentary_history ADD COLUMN created_at INTEGER`,
    `UPDATE commentary_history SET created_at = timestamp WHERE created_at IS NULL`,
  ];
  for (const sql of alterColumns) {
    try {
      db.exec(sql);
    } catch {
      /* column already exists */
    }
  }

  // Migrate: rename old project tables/columns to workspace (for existing databases)
  const migrations = [
    // Rename tables
    `ALTER TABLE projects RENAME TO workspaces`,
    `ALTER TABLE project_memories RENAME TO workspace_memories`,
    // Rename columns
    `ALTER TABLE conversations RENAME COLUMN project_path TO workspace_path`,
    `ALTER TABLE conversations RENAME COLUMN project_id TO workspace_id`,
    `ALTER TABLE git_snapshots RENAME COLUMN project_path TO workspace_path`,
    `ALTER TABLE workspace_memories RENAME COLUMN project_path TO workspace_path`,
    `ALTER TABLE prds RENAME COLUMN project_path TO workspace_path`,
    `ALTER TABLE loops RENAME COLUMN project_path TO workspace_path`,
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      /* already migrated or table doesn't exist */
    }
  }

  // Create workspace-related indexes AFTER migrations so columns exist
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_git_snapshots_path ON git_snapshots(workspace_path, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workspace_memories_path ON workspace_memories(workspace_path);
    CREATE INDEX IF NOT EXISTS idx_workspace_memories_category ON workspace_memories(workspace_path, category);
    CREATE INDEX IF NOT EXISTS idx_prds_workspace_path ON prds(workspace_path);
    CREATE INDEX IF NOT EXISTS idx_commentary_workspace ON commentary_history(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_commentary_conversation ON commentary_history(conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_commentary_timestamp ON commentary_history(timestamp DESC);
  `);

  // --- Work pane unification migrations ---

  // Add new columns (safe ALTER TABLE — no-ops if already exist)
  const workPaneColumns = [
    // Standalone stories need workspace_path directly on the story
    `ALTER TABLE prd_stories ADD COLUMN workspace_path TEXT`,
    // External integration scaffolding (Jira/Linear/Asana)
    `ALTER TABLE prd_stories ADD COLUMN external_ref TEXT`,
    `ALTER TABLE prd_stories ADD COLUMN external_status TEXT`,
    `ALTER TABLE prds ADD COLUMN external_ref TEXT`,
    `ALTER TABLE loops ADD COLUMN last_heartbeat INTEGER`,
  ];
  for (const sql of workPaneColumns) {
    try {
      db.exec(sql);
    } catch {
      /* column already exists */
    }
  }

  // Make prd_id nullable on prd_stories and loops.
  // SQLite doesn't support ALTER COLUMN, so we rebuild the tables.
  migrateNullablePrdId(db);

  // Migrate existing tasks into standalone stories
  migrateTasksToStories(db);

  // Create indexes for standalone story queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_prd_stories_workspace ON prd_stories(workspace_path);
  `);
}

/**
 * Rebuild prd_stories and loops tables to make prd_id nullable.
 * SQLite requires a full table rebuild to change column constraints.
 */
function migrateNullablePrdId(db: Database): void {
  // Check if prd_stories.prd_id is still NOT NULL
  const storyInfo = db.prepare('PRAGMA table_info(prd_stories)').all() as any[];
  const prdIdCol = storyInfo.find((c: any) => c.name === 'prd_id');

  if (prdIdCol && prdIdCol.notnull === 1) {
    // Must temporarily disable foreign keys for table rebuild
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('BEGIN TRANSACTION');
    try {
      db.exec(`
        CREATE TABLE prd_stories_new (
          id TEXT PRIMARY KEY,
          prd_id TEXT,
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
          estimate TEXT,
          dependency_reasons TEXT NOT NULL DEFAULT '{}',
          priority_recommendation TEXT,
          research_only INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          workspace_path TEXT,
          external_ref TEXT,
          external_status TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (prd_id) REFERENCES prds(id) ON DELETE CASCADE
        );

        INSERT INTO prd_stories_new (
          id, prd_id, title, description, acceptance_criteria, priority,
          depends_on, status, task_id, agent_id, conversation_id, commit_sha,
          attempts, max_attempts, learnings, estimate, dependency_reasons,
          priority_recommendation, research_only, sort_order, workspace_path,
          external_ref, external_status, created_at, updated_at
        )
        SELECT
          id, prd_id, title, description, acceptance_criteria, priority,
          depends_on, status, task_id, agent_id, conversation_id, commit_sha,
          attempts, max_attempts, learnings, estimate, dependency_reasons,
          priority_recommendation, COALESCE(research_only, 0), sort_order,
          workspace_path, external_ref, external_status, created_at, updated_at
        FROM prd_stories;

        DROP TABLE prd_stories;
        ALTER TABLE prd_stories_new RENAME TO prd_stories;
        CREATE INDEX IF NOT EXISTS idx_prd_stories_prd ON prd_stories(prd_id);
      `);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    db.exec('PRAGMA foreign_keys=ON');
  }

  // Check if loops.prd_id is still NOT NULL
  const loopInfo = db.prepare('PRAGMA table_info(loops)').all() as any[];
  const loopPrdIdCol = loopInfo.find((c: any) => c.name === 'prd_id');

  if (loopPrdIdCol && loopPrdIdCol.notnull === 1) {
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('BEGIN TRANSACTION');
    try {
      db.exec(`
        CREATE TABLE loops_new (
          id TEXT PRIMARY KEY,
          prd_id TEXT,
          workspace_path TEXT NOT NULL,
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

        INSERT INTO loops_new SELECT * FROM loops;
        DROP TABLE loops;
        ALTER TABLE loops_new RENAME TO loops;
        CREATE INDEX IF NOT EXISTS idx_loops_prd ON loops(prd_id);
        CREATE INDEX IF NOT EXISTS idx_loops_status ON loops(status);
      `);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    db.exec('PRAGMA foreign_keys=ON');
  }
}

/**
 * One-time migration: convert existing tasks into standalone stories (prd_id=NULL).
 * Gated by a settings key so it only runs once.
 */
function migrateTasksToStories(db: Database): void {
  const marker = db
    .query("SELECT value FROM settings WHERE key = 'tasks_migrated_to_stories'")
    .get() as any;
  if (marker) return;

  const tasks = db.query("SELECT * FROM tasks WHERE status != 'deleted'").all() as any[];

  const statusMap: Record<string, string> = {
    pending: 'pending',
    in_progress: 'in_progress',
    completed: 'completed',
  };

  for (const task of tasks) {
    const storyId = nanoid(12);
    const status = statusMap[task.status] || 'pending';

    db.query(
      `
      INSERT INTO prd_stories (
        id, prd_id, workspace_path, title, description, acceptance_criteria,
        priority, depends_on, dependency_reasons, status, task_id,
        attempts, max_attempts, learnings, sort_order, created_at, updated_at
      )
      VALUES (?, NULL, NULL, ?, ?, '[]', 'medium', ?, '{}', ?, ?, 0, 3, '[]', 0, ?, ?)
    `,
    ).run(
      storyId,
      task.subject,
      task.description || '',
      task.blocked_by || '[]',
      status,
      task.id,
      task.created_at,
      task.updated_at || Date.now(),
    );
  }

  db.query(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('tasks_migrated_to_stories', '1')",
  ).run();
}
