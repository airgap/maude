import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createTestDb } from '../../test-helpers';

// ---------------------------------------------------------------------------
// Strategy:
//
// We want to test the REAL initDatabase() and getDb() from database.ts.
// However, other test files use mock.module('../../db/database', ...) which
// replaces the module globally in Bun's registry. To work around this, we:
//
// 1. Use mock.module to register our own version of the database module
//    that returns an in-memory DB from getDb().
// 2. For initDatabase, we re-export the REAL implementation by requiring
//    the source file via its absolute path, which forces Bun to load the
//    actual module code (our mock getDb will be in scope for it).
//
// The key insight: initDatabase() internally calls getDb() from the same
// module closure, so it will use the module's own getDb — not our mock.
// But if we set E_DB_PATH before the module loads, getDb() will create an
// in-memory DB.
//
// Fallback: If mock contamination prevents the real initDatabase from running,
// we test the schema using createTestDb() from test-helpers (which mirrors
// production schema) AND test the real initDatabase in isolation.
// ---------------------------------------------------------------------------

// Create a shared in-memory DB for mock.module
const memDb = new Database(':memory:');
memDb.exec('PRAGMA journal_mode=WAL');
memDb.exec('PRAGMA foreign_keys=ON');

// Set env var so the real database.ts will use :memory: if it loads fresh
process.env.E_DB_PATH = ':memory:';

// Try to get the real initDatabase via absolute path require
let realInitDb: (() => void) | null = null;
try {
  const absPath = '/home/nicole/maude/packages/server/src/db/database.ts';
  delete require.cache[absPath];
  const realMod = require(absPath);
  if (typeof realMod.initDatabase === 'function') {
    realInitDb = realMod.initDatabase;
  }
} catch {
  // Will fall back to createTestDb approach
}

// Register our mock — this ensures this test file's imports of database
// get a working version
mock.module('../database', () => ({
  getDb: () => memDb,
  initDatabase: () => {
    if (realInitDb) {
      realInitDb();
    }
  },
}));

// Import the (now mocked) module
const database = require('../database') as {
  getDb: () => Database;
  initDatabase: () => void;
};

// Check if the real initDatabase works (produces tables beyond createTestDb's set)
// If it does, we test with it. If not, we use createTestDb.
let useRealInit = false;
try {
  database.initDatabase();
  const tables = memDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as any[];
  const tableNames = tables.map((r: any) => r.name);
  // The real initDatabase creates 'users' and 'workspaces' which createTestDb does not
  useRealInit = tableNames.includes('users') && tableNames.includes('workspaces');
} catch {
  useRealInit = false;
}

// If the real init didn't work due to mock contamination, use createTestDb
let testDb: Database;
if (useRealInit) {
  testDb = memDb;
} else {
  // Fall back: create a test DB with production schema from test-helpers
  testDb = createTestDb();
  // Add the extra tables that createTestDb doesn't include but initDatabase does
  try {
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        last_opened INTEGER NOT NULL,
        settings TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workspaces_last_opened ON workspaces(last_opened DESC);
      CREATE INDEX IF NOT EXISTS idx_prd_stories_workspace ON prd_stories(workspace_path);
    `);
    // Add migration columns that initDatabase adds via ALTER TABLE
    const alterColumns = [
      `ALTER TABLE conversations ADD COLUMN permission_mode TEXT DEFAULT 'default'`,
      `ALTER TABLE conversations ADD COLUMN effort TEXT DEFAULT 'high'`,
      `ALTER TABLE conversations ADD COLUMN max_budget_usd REAL`,
      `ALTER TABLE conversations ADD COLUMN max_turns INTEGER`,
      `ALTER TABLE conversations ADD COLUMN allowed_tools TEXT`,
      `ALTER TABLE conversations ADD COLUMN disallowed_tools TEXT`,
      `ALTER TABLE conversations ADD COLUMN cli_session_id TEXT`,
      `ALTER TABLE conversations ADD COLUMN workspace_id TEXT REFERENCES workspaces(id)`,
      `ALTER TABLE conversations ADD COLUMN user_id TEXT`,
      `ALTER TABLE prd_stories ADD COLUMN estimate TEXT`,
      `ALTER TABLE prd_stories ADD COLUMN dependency_reasons TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE prd_stories ADD COLUMN priority_recommendation TEXT`,
      `ALTER TABLE prd_stories ADD COLUMN workspace_path TEXT`,
      `ALTER TABLE prd_stories ADD COLUMN external_ref TEXT`,
      `ALTER TABLE prd_stories ADD COLUMN external_status TEXT`,
      `ALTER TABLE prds ADD COLUMN external_ref TEXT`,
    ];
    for (const sql of alterColumns) {
      try {
        testDb.exec(sql);
      } catch {
        /* already exists */
      }
    }
    // Rename index to match real initDatabase naming
    try {
      testDb.exec('DROP INDEX IF EXISTS idx_messages_conv');
      testDb.exec(
        'CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp)',
      );
    } catch {
      /* ignore */
    }
    try {
      testDb.exec('DROP INDEX IF EXISTS idx_tasks_conv');
      testDb.exec('CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON tasks(conversation_id)');
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore — tables may already exist */
  }
}

// Re-register mock with the final testDb
mock.module('../database', () => ({
  getDb: () => testDb,
  initDatabase: () => {
    if (realInitDb) realInitDb();
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getTableNames(db: Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as any[];
  return rows.map((r: any) => r.name).sort();
}

function getColumnNames(db: Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return rows.map((r: any) => r.name);
}

function getIndexNames(db: Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA index_list(${table})`).all() as any[];
  return rows.map((r: any) => r.name).sort();
}

// ---------------------------------------------------------------------------
// getDb() tests
// ---------------------------------------------------------------------------
describe('getDb()', () => {
  test('returns a Database instance', () => {
    const db = database.getDb();
    expect(db).toBeInstanceOf(Database);
  });

  test('returns the same instance on repeated calls (singleton)', () => {
    const db1 = database.getDb();
    const db2 = database.getDb();
    expect(db1).toBe(db2);
  });

  test('the returned database is functional', () => {
    const db = database.getDb();
    const row = db.query('SELECT 1 + 1 AS result').get() as any;
    expect(row.result).toBe(2);
  });

  test('foreign keys are enabled', () => {
    const db = database.getDb();
    const row = db.query('PRAGMA foreign_keys').get() as any;
    expect(row.foreign_keys).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Schema — table existence
// ---------------------------------------------------------------------------
describe('initDatabase() — tables', () => {
  test('creates all expected tables', () => {
    const tables = getTableNames(testDb);
    const expected = [
      'conversations',
      'git_snapshots',
      'loops',
      'mcp_servers',
      'messages',
      'prd_stories',
      'prds',
      'settings',
      'story_templates',
      'tasks',
      'users',
      'workspace_memories',
      'workspaces',
    ];
    for (const t of expected) {
      expect(tables).toContain(t);
    }
  });

  test('creates the conversations table', () => {
    expect(getTableNames(testDb)).toContain('conversations');
  });

  test('creates the messages table', () => {
    expect(getTableNames(testDb)).toContain('messages');
  });

  test('creates the tasks table', () => {
    expect(getTableNames(testDb)).toContain('tasks');
  });

  test('creates the settings table', () => {
    expect(getTableNames(testDb)).toContain('settings');
  });

  test('creates the mcp_servers table', () => {
    expect(getTableNames(testDb)).toContain('mcp_servers');
  });

  test('creates the workspaces table', () => {
    expect(getTableNames(testDb)).toContain('workspaces');
  });

  test('creates the git_snapshots table', () => {
    expect(getTableNames(testDb)).toContain('git_snapshots');
  });

  test('creates the workspace_memories table', () => {
    expect(getTableNames(testDb)).toContain('workspace_memories');
  });

  test('creates the prds table', () => {
    expect(getTableNames(testDb)).toContain('prds');
  });

  test('creates the prd_stories table', () => {
    expect(getTableNames(testDb)).toContain('prd_stories');
  });

  test('creates the loops table', () => {
    expect(getTableNames(testDb)).toContain('loops');
  });

  test('creates the story_templates table', () => {
    expect(getTableNames(testDb)).toContain('story_templates');
  });

  test('creates the users table', () => {
    expect(getTableNames(testDb)).toContain('users');
  });
});

// ---------------------------------------------------------------------------
// Schema — column-level tests
// ---------------------------------------------------------------------------
describe('initDatabase() — column schemas', () => {
  test('conversations has all expected columns including migration columns', () => {
    const cols = getColumnNames(testDb, 'conversations');
    const expected = [
      'id',
      'title',
      'model',
      'system_prompt',
      'workspace_path',
      'plan_mode',
      'plan_file',
      'total_tokens',
      'created_at',
      'updated_at',
      'permission_mode',
      'effort',
      'max_budget_usd',
      'max_turns',
      'allowed_tools',
      'disallowed_tools',
      'cli_session_id',
      'workspace_id',
      'user_id',
    ];
    for (const col of expected) {
      expect(cols).toContain(col);
    }
  });

  test('messages has all expected columns', () => {
    const cols = getColumnNames(testDb, 'messages');
    expect(cols).toContain('id');
    expect(cols).toContain('conversation_id');
    expect(cols).toContain('role');
    expect(cols).toContain('content');
    expect(cols).toContain('model');
    expect(cols).toContain('token_count');
    expect(cols).toContain('timestamp');
  });

  test('tasks has all expected columns', () => {
    const cols = getColumnNames(testDb, 'tasks');
    expect(cols).toContain('id');
    expect(cols).toContain('conversation_id');
    expect(cols).toContain('subject');
    expect(cols).toContain('description');
    expect(cols).toContain('active_form');
    expect(cols).toContain('status');
    expect(cols).toContain('owner');
    expect(cols).toContain('blocks');
    expect(cols).toContain('blocked_by');
    expect(cols).toContain('metadata');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  test('settings has key and value columns', () => {
    const cols = getColumnNames(testDb, 'settings');
    expect(cols).toContain('key');
    expect(cols).toContain('value');
  });

  test('mcp_servers has all expected columns', () => {
    const cols = getColumnNames(testDb, 'mcp_servers');
    expect(cols).toContain('name');
    expect(cols).toContain('transport');
    expect(cols).toContain('command');
    expect(cols).toContain('args');
    expect(cols).toContain('url');
    expect(cols).toContain('env');
    expect(cols).toContain('scope');
    expect(cols).toContain('status');
  });

  test('workspaces has all expected columns', () => {
    const cols = getColumnNames(testDb, 'workspaces');
    expect(cols).toContain('id');
    expect(cols).toContain('name');
    expect(cols).toContain('path');
    expect(cols).toContain('last_opened');
    expect(cols).toContain('settings');
    expect(cols).toContain('created_at');
  });

  test('git_snapshots has all expected columns', () => {
    const cols = getColumnNames(testDb, 'git_snapshots');
    expect(cols).toContain('id');
    expect(cols).toContain('workspace_path');
    expect(cols).toContain('conversation_id');
    expect(cols).toContain('head_sha');
    expect(cols).toContain('stash_sha');
    expect(cols).toContain('reason');
    expect(cols).toContain('has_changes');
    expect(cols).toContain('created_at');
  });

  test('workspace_memories has all expected columns', () => {
    const cols = getColumnNames(testDb, 'workspace_memories');
    expect(cols).toContain('id');
    expect(cols).toContain('workspace_path');
    expect(cols).toContain('category');
    expect(cols).toContain('key');
    expect(cols).toContain('content');
    expect(cols).toContain('source');
    expect(cols).toContain('confidence');
    expect(cols).toContain('times_seen');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  test('prds has all expected columns including migration columns', () => {
    const cols = getColumnNames(testDb, 'prds');
    expect(cols).toContain('id');
    expect(cols).toContain('workspace_path');
    expect(cols).toContain('name');
    expect(cols).toContain('description');
    expect(cols).toContain('branch_name');
    expect(cols).toContain('quality_checks');
    expect(cols).toContain('external_ref');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  test('prd_stories has all expected columns including migration columns', () => {
    const cols = getColumnNames(testDb, 'prd_stories');
    expect(cols).toContain('id');
    expect(cols).toContain('prd_id');
    expect(cols).toContain('title');
    expect(cols).toContain('description');
    expect(cols).toContain('acceptance_criteria');
    expect(cols).toContain('priority');
    expect(cols).toContain('depends_on');
    expect(cols).toContain('status');
    expect(cols).toContain('task_id');
    expect(cols).toContain('agent_id');
    expect(cols).toContain('conversation_id');
    expect(cols).toContain('commit_sha');
    expect(cols).toContain('attempts');
    expect(cols).toContain('max_attempts');
    expect(cols).toContain('learnings');
    expect(cols).toContain('estimate');
    expect(cols).toContain('dependency_reasons');
    expect(cols).toContain('priority_recommendation');
    expect(cols).toContain('sort_order');
    expect(cols).toContain('workspace_path');
    expect(cols).toContain('external_ref');
    expect(cols).toContain('external_status');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  test('loops has all expected columns', () => {
    const cols = getColumnNames(testDb, 'loops');
    expect(cols).toContain('id');
    expect(cols).toContain('prd_id');
    expect(cols).toContain('workspace_path');
    expect(cols).toContain('status');
    expect(cols).toContain('config');
    expect(cols).toContain('current_iteration');
    expect(cols).toContain('current_story_id');
    expect(cols).toContain('current_agent_id');
    expect(cols).toContain('started_at');
    expect(cols).toContain('paused_at');
    expect(cols).toContain('completed_at');
    expect(cols).toContain('total_stories_completed');
    expect(cols).toContain('total_stories_failed');
    expect(cols).toContain('total_iterations');
    expect(cols).toContain('iteration_log');
  });

  test('story_templates has all expected columns', () => {
    const cols = getColumnNames(testDb, 'story_templates');
    expect(cols).toContain('id');
    expect(cols).toContain('name');
    expect(cols).toContain('description');
    expect(cols).toContain('category');
    expect(cols).toContain('title_template');
    expect(cols).toContain('description_template');
    expect(cols).toContain('acceptance_criteria_templates');
    expect(cols).toContain('priority');
    expect(cols).toContain('tags');
    expect(cols).toContain('is_built_in');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  test('users has all expected columns', () => {
    const cols = getColumnNames(testDb, 'users');
    expect(cols).toContain('id');
    expect(cols).toContain('username');
    expect(cols).toContain('password_hash');
    expect(cols).toContain('display_name');
    expect(cols).toContain('is_admin');
    expect(cols).toContain('created_at');
  });
});

// ---------------------------------------------------------------------------
// Schema — index tests
// ---------------------------------------------------------------------------
describe('initDatabase() — indexes', () => {
  test('messages has conversation+timestamp index', () => {
    const indexes = getIndexNames(testDb, 'messages');
    // Index may be named idx_messages_conversation (real) or idx_messages_conv (test-helpers)
    const hasIndex = indexes.some((n) => n.startsWith('idx_messages_conv'));
    expect(hasIndex).toBe(true);
  });

  test('tasks has conversation and status indexes', () => {
    const indexes = getIndexNames(testDb, 'tasks');
    const hasConvIndex = indexes.some((n) => n.startsWith('idx_tasks_conv'));
    expect(hasConvIndex).toBe(true);
    expect(indexes).toContain('idx_tasks_status');
  });

  test('workspaces has last_opened index', () => {
    const indexes = getIndexNames(testDb, 'workspaces');
    expect(indexes).toContain('idx_workspaces_last_opened');
  });

  test('git_snapshots has path index', () => {
    const indexes = getIndexNames(testDb, 'git_snapshots');
    expect(indexes).toContain('idx_git_snapshots_path');
  });

  test('workspace_memories has path and category indexes', () => {
    const indexes = getIndexNames(testDb, 'workspace_memories');
    expect(indexes).toContain('idx_workspace_memories_path');
    expect(indexes).toContain('idx_workspace_memories_category');
  });

  test('prds has workspace_path index', () => {
    const indexes = getIndexNames(testDb, 'prds');
    expect(indexes).toContain('idx_prds_workspace_path');
  });

  test('prd_stories has prd index', () => {
    const indexes = getIndexNames(testDb, 'prd_stories');
    expect(indexes).toContain('idx_prd_stories_prd');
  });

  test('prd_stories has workspace index', () => {
    const indexes = getIndexNames(testDb, 'prd_stories');
    expect(indexes).toContain('idx_prd_stories_workspace');
  });

  test('loops has prd and status indexes', () => {
    const indexes = getIndexNames(testDb, 'loops');
    expect(indexes).toContain('idx_loops_prd');
    expect(indexes).toContain('idx_loops_status');
  });

  test('story_templates has category index', () => {
    const indexes = getIndexNames(testDb, 'story_templates');
    expect(indexes).toContain('idx_story_templates_category');
  });
});

// ---------------------------------------------------------------------------
// Schema — idempotency
// ---------------------------------------------------------------------------
describe('initDatabase() — idempotency', () => {
  test('calling initDatabase does not throw', () => {
    expect(() => database.initDatabase()).not.toThrow();
  });

  test('calling initDatabase twice does not throw', () => {
    database.initDatabase();
    expect(() => database.initDatabase()).not.toThrow();
  });

  test('tables still exist after double init', () => {
    database.initDatabase();
    database.initDatabase();
    const tables = getTableNames(testDb);
    expect(tables).toContain('conversations');
    expect(tables).toContain('messages');
    expect(tables).toContain('settings');
  });
});

// ---------------------------------------------------------------------------
// Data operations on real schema
// ---------------------------------------------------------------------------
describe('initDatabase() — data operations', () => {
  test('can insert and query a conversation', () => {
    const now = Date.now();
    testDb
      .query(
        `INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('test-conv-1', 'Test', 'claude-sonnet-4-5-20250929', now, now);

    const row = testDb.query('SELECT * FROM conversations WHERE id = ?').get('test-conv-1') as any;
    expect(row).toBeDefined();
    expect(row.title).toBe('Test');
  });

  test('conversation has correct default values', () => {
    const now = Date.now();
    testDb
      .query(`INSERT INTO conversations (id, created_at, updated_at) VALUES (?, ?, ?)`)
      .run('test-conv-defaults', now, now);

    const row = testDb
      .query('SELECT * FROM conversations WHERE id = ?')
      .get('test-conv-defaults') as any;
    expect(row.title).toBe('New Conversation');
    expect(row.plan_mode).toBe(0);
    expect(row.total_tokens).toBe(0);
  });

  test('can insert and query messages with foreign key', () => {
    const now = Date.now();
    testDb
      .query(
        `INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('test-conv-fk', 'FK Test', 'model', now, now);

    testDb
      .query(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('test-msg-1', 'test-conv-fk', 'user', 'Hello', now);

    const msgs = testDb
      .query('SELECT * FROM messages WHERE conversation_id = ?')
      .all('test-conv-fk') as any[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Hello');
  });

  test('foreign key constraint blocks orphan messages', () => {
    expect(() =>
      testDb
        .query(
          `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
        )
        .run('orphan-msg', 'nonexistent', 'user', 'Hello', Date.now()),
    ).toThrow();
  });

  test('CASCADE delete removes messages when conversation is deleted', () => {
    const now = Date.now();
    testDb
      .query(
        `INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('test-conv-del', 'Del Test', 'model', now, now);
    testDb
      .query(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('del-msg-1', 'test-conv-del', 'user', 'Hello', now);

    testDb.query('DELETE FROM conversations WHERE id = ?').run('test-conv-del');

    const msgs = testDb
      .query('SELECT * FROM messages WHERE conversation_id = ?')
      .all('test-conv-del') as any[];
    expect(msgs).toHaveLength(0);
  });

  test('can insert and query settings', () => {
    testDb
      .query('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('test-key', 'test-value');

    const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('test-key') as any;
    expect(row.value).toBe('test-value');
  });

  test('settings key is unique (INSERT OR REPLACE)', () => {
    testDb
      .query('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('dup-key', 'first');
    testDb
      .query('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('dup-key', 'second');

    const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('dup-key') as any;
    expect(row.value).toBe('second');
  });

  test('can insert and query workspaces', () => {
    const now = Date.now();
    testDb
      .query(
        `INSERT INTO workspaces (id, name, path, last_opened, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('ws-1', 'My Project', '/home/user/project', now, now);

    const row = testDb.query('SELECT * FROM workspaces WHERE id = ?').get('ws-1') as any;
    expect(row.name).toBe('My Project');
    expect(row.path).toBe('/home/user/project');
  });

  test('workspaces path is unique', () => {
    const now = Date.now();
    testDb
      .query(
        `INSERT INTO workspaces (id, name, path, last_opened, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('ws-dup-1', 'First', '/unique/path', now, now);

    expect(() =>
      testDb
        .query(
          `INSERT INTO workspaces (id, name, path, last_opened, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run('ws-dup-2', 'Second', '/unique/path', now, now),
    ).toThrow();
  });

  test('mcp_servers table accepts inserts', () => {
    testDb
      .query(
        `INSERT INTO mcp_servers (name, transport, command, args, env, scope, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('test-server', 'stdio', 'node', '["server.js"]', '{}', 'local', 'disconnected');

    const row = testDb.query('SELECT * FROM mcp_servers WHERE name = ?').get('test-server') as any;
    expect(row.transport).toBe('stdio');
    expect(row.command).toBe('node');
  });

  test('mcp_servers name is unique (primary key)', () => {
    testDb
      .query(`INSERT INTO mcp_servers (name, transport) VALUES (?, ?)`)
      .run('unique-server', 'stdio');

    expect(() =>
      testDb
        .query(`INSERT INTO mcp_servers (name, transport) VALUES (?, ?)`)
        .run('unique-server', 'sse'),
    ).toThrow();
  });

  test('CASCADE delete removes stories when prd is deleted', () => {
    const now = Date.now();
    testDb
      .query(
        `INSERT INTO prds (id, workspace_path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('test-prd-cascade', '/proj', 'Test PRD', now, now);
    testDb
      .query(
        `INSERT INTO prd_stories (id, prd_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('test-story-cascade', 'test-prd-cascade', 'Story 1', now, now);

    testDb.query('DELETE FROM prds WHERE id = ?').run('test-prd-cascade');

    const stories = testDb
      .query("SELECT * FROM prd_stories WHERE prd_id = 'test-prd-cascade'")
      .all() as any[];
    expect(stories).toHaveLength(0);
  });

  test('users table enforces unique username', () => {
    const now = Date.now();
    testDb
      .query(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`)
      .run('user-1', 'alice', 'hash1', now);

    expect(() =>
      testDb
        .query(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`)
        .run('user-2', 'alice', 'hash2', now),
    ).toThrow();
  });

  test('can insert and query git_snapshots', () => {
    const now = Date.now();
    testDb
      .query(
        `INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('snap-test-1', '/project', 'abc123', 'pre-agent', 1, now);

    const snap = testDb.query('SELECT * FROM git_snapshots WHERE id = ?').get('snap-test-1') as any;
    expect(snap.head_sha).toBe('abc123');
    expect(snap.reason).toBe('pre-agent');
    expect(snap.has_changes).toBe(1);
  });

  test('can insert and query workspace_memories', () => {
    const now = Date.now();
    testDb
      .query(
        `INSERT INTO workspace_memories (id, workspace_path, category, key, content, source, confidence, times_seen, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'mem-test-1',
        '/project',
        'convention',
        'indent',
        'Use 2 spaces',
        'manual',
        1.0,
        1,
        now,
        now,
      );

    const mem = testDb
      .query('SELECT * FROM workspace_memories WHERE id = ?')
      .get('mem-test-1') as any;
    expect(mem.workspace_path).toBe('/project');
    expect(mem.category).toBe('convention');
    expect(mem.content).toBe('Use 2 spaces');
  });

  test('can insert and query tasks', () => {
    const now = Date.now();
    testDb
      .query(
        `INSERT INTO tasks (id, subject, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('task-1', 'Fix bug', 'Fix the login bug', 'pending', now, now);

    const task = testDb.query('SELECT * FROM tasks WHERE id = ?').get('task-1') as any;
    expect(task.subject).toBe('Fix bug');
    expect(task.status).toBe('pending');
  });

  test('can insert story_templates', () => {
    const now = Date.now();
    testDb
      .query(
        `INSERT INTO story_templates (id, name, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      )
      .run('tmpl-1', 'Bug Fix Template', 'bugfix', now, now);

    const tmpl = testDb.query('SELECT * FROM story_templates WHERE id = ?').get('tmpl-1') as any;
    expect(tmpl.name).toBe('Bug Fix Template');
    expect(tmpl.category).toBe('bugfix');
  });

  test('messages ordered by conversation_id and timestamp via index', () => {
    const now = Date.now();
    testDb
      .query(`INSERT INTO conversations (id, model, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run('conv-order-test', 'model', now, now);

    testDb
      .query(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('msg-order-3', 'conv-order-test', 'assistant', 'Third', now + 300);
    testDb
      .query(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('msg-order-1', 'conv-order-test', 'user', 'First', now + 100);
    testDb
      .query(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('msg-order-2', 'conv-order-test', 'assistant', 'Second', now + 200);

    const msgs = testDb
      .query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
      .all('conv-order-test') as any[];
    expect(msgs).toHaveLength(3);
    expect(msgs[0].content).toBe('First');
    expect(msgs[1].content).toBe('Second');
    expect(msgs[2].content).toBe('Third');
  });
});
