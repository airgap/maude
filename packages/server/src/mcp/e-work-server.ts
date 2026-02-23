#!/usr/bin/env bun
/**
 * E Work MCP Server — Exposes PRD, story, and loop management as MCP tools.
 *
 * This is a standalone MCP server that communicates via JSON-RPC 2.0 over stdio.
 * It connects directly to E's SQLite database so agents can manipulate the work
 * system without HTTP/CSRF overhead.
 *
 * Usage: bun packages/server/src/mcp/e-work-server.ts
 *
 * Registered as MCP server "e-work" in E's server on startup.
 */

import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { nanoid } from 'nanoid';
import { createInterface } from 'readline';

// ── Database Connection ──

const DB_PATH = Bun.env.E_DB_PATH || join(homedir(), '.e', 'e.db');
let db: Database;

function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}

// ── Row Helpers ──

function prdFromRow(row: any) {
  return {
    id: row.id,
    workspacePath: row.workspace_path,
    name: row.name,
    description: row.description,
    branchName: row.branch_name,
    qualityChecks: JSON.parse(row.quality_checks || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function storyFromRow(row: any) {
  return {
    id: row.id,
    prdId: row.prd_id || null,
    workspacePath: row.workspace_path || undefined,
    title: row.title,
    description: row.description,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria || '[]'),
    priority: row.priority,
    dependsOn: JSON.parse(row.depends_on || '[]'),
    dependencyReasons: JSON.parse(row.dependency_reasons || '{}'),
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    learnings: JSON.parse(row.learnings || '[]'),
    estimate: row.estimate ? JSON.parse(row.estimate) : undefined,
    researchOnly: !!row.research_only,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Tool Definitions ──

const TOOLS = [
  // ── PRD Management ──
  {
    name: 'list_prds',
    description:
      'List all PRDs (Product Requirement Documents) for a workspace. Returns id, name, description, story count.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: {
          type: 'string',
          description: 'Absolute path to the workspace directory',
        },
      },
      required: ['workspacePath'],
    },
  },
  {
    name: 'get_prd',
    description: 'Get a PRD by ID, including all its stories.',
    inputSchema: {
      type: 'object',
      properties: {
        prdId: { type: 'string', description: 'The PRD ID' },
      },
      required: ['prdId'],
    },
  },
  {
    name: 'create_prd',
    description:
      'Create a new PRD with optional initial stories. Returns the PRD ID and story IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: {
          type: 'string',
          description: 'Absolute path to the workspace directory',
        },
        name: { type: 'string', description: 'PRD name/title' },
        description: {
          type: 'string',
          description: 'PRD description — goals, context, architecture notes',
        },
        branchName: {
          type: 'string',
          description: 'Optional git branch name for this PRD',
        },
        stories: {
          type: 'array',
          description: 'Optional initial stories to create with the PRD',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Story title' },
              description: { type: 'string', description: 'Detailed story description' },
              acceptanceCriteria: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of acceptance criteria strings',
              },
              priority: {
                type: 'string',
                enum: ['critical', 'high', 'medium', 'low'],
                description: 'Story priority (default: medium)',
              },
            },
            required: ['title', 'acceptanceCriteria'],
          },
        },
      },
      required: ['workspacePath', 'name'],
    },
  },
  {
    name: 'update_prd',
    description: 'Update PRD metadata (name, description, branchName).',
    inputSchema: {
      type: 'object',
      properties: {
        prdId: { type: 'string', description: 'The PRD ID to update' },
        name: { type: 'string', description: 'New PRD name' },
        description: { type: 'string', description: 'New PRD description' },
        branchName: { type: 'string', description: 'New branch name' },
      },
      required: ['prdId'],
    },
  },
  {
    name: 'delete_prd',
    description: 'Delete a PRD and all its stories (cascading delete).',
    inputSchema: {
      type: 'object',
      properties: {
        prdId: { type: 'string', description: 'The PRD ID to delete' },
      },
      required: ['prdId'],
    },
  },

  // ── Story Management ──
  {
    name: 'list_stories',
    description:
      'List stories for a workspace. Can filter by PRD, status, or list all. Returns full story objects.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: {
          type: 'string',
          description: 'Absolute path to the workspace directory',
        },
        prdId: {
          type: 'string',
          description: 'Filter to stories in this PRD. Omit for standalone stories.',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'failed', 'archived', 'paused'],
          description: 'Filter by status. Omit for all statuses.',
        },
        includeAll: {
          type: 'boolean',
          description: 'If true, return all stories (standalone + PRD-bound) for the workspace.',
        },
      },
      required: ['workspacePath'],
    },
  },
  {
    name: 'create_story',
    description:
      'Create a new story, either standalone (no PRD) or attached to a PRD. Returns the created story.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: {
          type: 'string',
          description: 'Absolute path to the workspace directory (required for standalone stories)',
        },
        prdId: {
          type: 'string',
          description: 'PRD ID to attach this story to. Omit for standalone story.',
        },
        title: { type: 'string', description: 'Story title' },
        description: { type: 'string', description: 'Detailed story description' },
        acceptanceCriteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of acceptance criteria strings',
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'Story priority (default: medium)',
        },
        dependsOn: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of story IDs this story depends on',
        },
        researchOnly: {
          type: 'boolean',
          description: 'If true, story is for research/discovery only — excluded from loops',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_story',
    description:
      'Update any fields on an existing story: title, description, status, priority, acceptance criteria, dependencies, learnings, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        storyId: { type: 'string', description: 'The story ID to update' },
        prdId: {
          type: 'string',
          description: 'PRD ID if this is a PRD-bound story. Omit for standalone.',
        },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'failed', 'archived', 'paused'],
          description: 'New status',
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'New priority',
        },
        acceptanceCriteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replace acceptance criteria (array of strings)',
        },
        dependsOn: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replace dependency list (array of story IDs)',
        },
        researchOnly: {
          type: 'boolean',
          description: 'Set research-only flag',
        },
        learnings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replace learnings list',
        },
      },
      required: ['storyId'],
    },
  },
  {
    name: 'delete_story',
    description: 'Delete a story by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        storyId: { type: 'string', description: 'The story ID to delete' },
        prdId: {
          type: 'string',
          description: 'PRD ID if this is a PRD-bound story. Omit for standalone.',
        },
      },
      required: ['storyId'],
    },
  },
  {
    name: 'reorder_stories',
    description:
      'Set the order of stories by providing an array of story IDs in the desired order. Works for both standalone and PRD-bound stories.',
    inputSchema: {
      type: 'object',
      properties: {
        storyIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Story IDs in the desired order',
        },
      },
      required: ['storyIds'],
    },
  },
  {
    name: 'archive_completed_stories',
    description: 'Archive all completed stories in a workspace or PRD.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: {
          type: 'string',
          description: 'Workspace path for standalone stories',
        },
        prdId: {
          type: 'string',
          description: 'PRD ID for PRD-bound stories',
        },
      },
    },
  },

  // ── Bulk Operations ──
  {
    name: 'batch_create_stories',
    description:
      'Create multiple stories at once, either standalone or within a PRD. More efficient than creating one at a time. Returns all created story IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: {
          type: 'string',
          description: 'Workspace path (required for standalone stories)',
        },
        prdId: {
          type: 'string',
          description: 'PRD ID to attach stories to. Omit for standalone.',
        },
        stories: {
          type: 'array',
          description: 'Array of stories to create',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              acceptanceCriteria: { type: 'array', items: { type: 'string' } },
              priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
              dependsOn: { type: 'array', items: { type: 'string' } },
              researchOnly: { type: 'boolean' },
            },
            required: ['title'],
          },
        },
      },
      required: ['stories'],
    },
  },
  {
    name: 'batch_update_stories',
    description:
      'Update multiple stories at once. Each entry specifies a storyId and the fields to update.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          description: 'Array of story updates',
          items: {
            type: 'object',
            properties: {
              storyId: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'failed', 'archived', 'paused'],
              },
              priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
              acceptanceCriteria: { type: 'array', items: { type: 'string' } },
              dependsOn: { type: 'array', items: { type: 'string' } },
              researchOnly: { type: 'boolean' },
              learnings: { type: 'array', items: { type: 'string' } },
            },
            required: ['storyId'],
          },
        },
      },
      required: ['updates'],
    },
  },

  // ── Loop / Golem Management ──
  {
    name: 'list_loops',
    description: 'List active and recent automation loops (Golem runs).',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['running', 'paused', 'completed', 'failed', 'cancelled', 'idle'],
          description: 'Filter by loop status. Omit for all.',
        },
      },
    },
  },
  {
    name: 'get_loop',
    description: 'Get details of a specific automation loop including current progress.',
    inputSchema: {
      type: 'object',
      properties: {
        loopId: { type: 'string', description: 'The loop ID' },
      },
      required: ['loopId'],
    },
  },
];

// ── Tool Handlers ──

async function handleToolCall(
  name: string,
  args: Record<string, any>,
): Promise<{ content: any[]; isError?: boolean }> {
  const d = getDb();

  try {
    switch (name) {
      // ── PRD Management ──

      case 'list_prds': {
        const rows = d
          .query('SELECT * FROM prds WHERE workspace_path = ? ORDER BY updated_at DESC')
          .all(args.workspacePath) as any[];

        const prds = rows.map((row) => {
          const storyCount =
            (
              d
                .query('SELECT COUNT(*) as count FROM prd_stories WHERE prd_id = ?')
                .get(row.id) as any
            )?.count ?? 0;
          return { ...prdFromRow(row), storyCount };
        });

        return { content: [{ type: 'text', text: JSON.stringify(prds, null, 2) }] };
      }

      case 'get_prd': {
        const row = d.query('SELECT * FROM prds WHERE id = ?').get(args.prdId) as any;
        if (!row) return error(`PRD not found: ${args.prdId}`);

        const storyRows = d
          .query(
            'SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC',
          )
          .all(args.prdId) as any[];

        const prd = { ...prdFromRow(row), stories: storyRows.map(storyFromRow) };
        return { content: [{ type: 'text', text: JSON.stringify(prd, null, 2) }] };
      }

      case 'create_prd': {
        const prdId = nanoid(12);
        const now = Date.now();

        d.query(
          `INSERT INTO prds (id, workspace_path, name, description, branch_name, quality_checks, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          prdId,
          args.workspacePath,
          args.name,
          args.description || '',
          args.branchName || null,
          JSON.stringify(args.qualityChecks || []),
          now,
          now,
        );

        const storyIds: string[] = [];
        if (args.stories?.length) {
          const storyInsert = d.query(
            `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (let i = 0; i < args.stories.length; i++) {
            const s = args.stories[i];
            const sid = nanoid(12);
            storyIds.push(sid);
            const criteria = (s.acceptanceCriteria || []).map((desc: string) => ({
              id: nanoid(8),
              description: desc,
              passed: false,
            }));
            storyInsert.run(
              sid,
              prdId,
              s.title,
              s.description || '',
              JSON.stringify(criteria),
              s.priority || 'medium',
              JSON.stringify(s.dependsOn || []),
              i,
              now,
              now,
            );
          }
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({ id: prdId, storyIds }) }],
        };
      }

      case 'update_prd': {
        const existing = d.query('SELECT * FROM prds WHERE id = ?').get(args.prdId);
        if (!existing) return error(`PRD not found: ${args.prdId}`);

        const updates: string[] = [];
        const values: any[] = [];
        if (args.name !== undefined) {
          updates.push('name = ?');
          values.push(args.name);
        }
        if (args.description !== undefined) {
          updates.push('description = ?');
          values.push(args.description);
        }
        if (args.branchName !== undefined) {
          updates.push('branch_name = ?');
          values.push(args.branchName);
        }
        if (updates.length > 0) {
          updates.push('updated_at = ?');
          values.push(Date.now());
          values.push(args.prdId);
          d.query(`UPDATE prds SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        }
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      }

      case 'delete_prd': {
        d.query('DELETE FROM prd_stories WHERE prd_id = ?').run(args.prdId);
        d.query('DELETE FROM prds WHERE id = ?').run(args.prdId);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      }

      // ── Story Management ──

      case 'list_stories': {
        let rows: any[];

        if (args.includeAll) {
          // All stories for workspace (standalone + PRD-bound)
          const standalone = d
            .query(
              'SELECT * FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? ORDER BY sort_order ASC',
            )
            .all(args.workspacePath) as any[];
          const prdBound = d
            .query(
              `SELECT ps.*, p.name as prd_name FROM prd_stories ps
               JOIN prds p ON ps.prd_id = p.id
               WHERE p.workspace_path = ?
               ORDER BY ps.prd_id, ps.sort_order ASC`,
            )
            .all(args.workspacePath) as any[];
          rows = [...standalone, ...prdBound.map((r: any) => ({ ...r, _prdName: r.prd_name }))];
        } else if (args.prdId) {
          rows = d
            .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
            .all(args.prdId) as any[];
        } else {
          rows = d
            .query(
              'SELECT * FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? ORDER BY sort_order ASC',
            )
            .all(args.workspacePath) as any[];
        }

        if (args.status) {
          rows = rows.filter((r: any) => r.status === args.status);
        }

        const stories = rows.map((r: any) => {
          const s = storyFromRow(r);
          if (r._prdName) (s as any).prdName = r._prdName;
          return s;
        });

        return { content: [{ type: 'text', text: JSON.stringify(stories, null, 2) }] };
      }

      case 'create_story': {
        const id = nanoid(12);
        const now = Date.now();
        const prdId = args.prdId || null;
        const workspacePath = args.workspacePath || null;

        // Get max sort_order
        let maxRow: any;
        if (prdId) {
          maxRow = d
            .query('SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id = ?')
            .get(prdId);
        } else {
          maxRow = d
            .query(
              'SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ?',
            )
            .get(workspacePath);
        }
        const sortOrder = (maxRow?.max_order ?? -1) + 1;

        const criteria = (args.acceptanceCriteria || []).map((desc: string) => ({
          id: nanoid(6),
          description: desc,
          passed: false,
        }));

        d.query(
          `INSERT INTO prd_stories (
            id, prd_id, workspace_path, title, description, acceptance_criteria,
            priority, depends_on, dependency_reasons, status, research_only,
            attempts, max_attempts, learnings, sort_order, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'pending', ?, 0, 3, '[]', ?, ?, ?)`,
        ).run(
          id,
          prdId,
          workspacePath,
          args.title,
          args.description || '',
          JSON.stringify(criteria),
          args.priority || 'medium',
          JSON.stringify(args.dependsOn || []),
          args.researchOnly ? 1 : 0,
          sortOrder,
          now,
          now,
        );

        const row = d.query('SELECT * FROM prd_stories WHERE id = ?').get(id) as any;
        return {
          content: [{ type: 'text', text: JSON.stringify(storyFromRow(row), null, 2) }],
        };
      }

      case 'update_story': {
        const { storyId, prdId: _prdId, ...fields } = args;
        const existing = d.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
        if (!existing) return error(`Story not found: ${storyId}`);

        const updates: string[] = [];
        const values: any[] = [];

        if (fields.title !== undefined) {
          updates.push('title = ?');
          values.push(fields.title);
        }
        if (fields.description !== undefined) {
          updates.push('description = ?');
          values.push(fields.description);
        }
        if (fields.status !== undefined) {
          updates.push('status = ?');
          values.push(fields.status);
        }
        if (fields.priority !== undefined) {
          updates.push('priority = ?');
          values.push(fields.priority);
        }
        if (fields.acceptanceCriteria !== undefined) {
          const criteria = fields.acceptanceCriteria.map((desc: string) => ({
            id: nanoid(6),
            description: desc,
            passed: false,
          }));
          updates.push('acceptance_criteria = ?');
          values.push(JSON.stringify(criteria));
        }
        if (fields.dependsOn !== undefined) {
          updates.push('depends_on = ?');
          values.push(JSON.stringify(fields.dependsOn));
        }
        if (fields.researchOnly !== undefined) {
          updates.push('research_only = ?');
          values.push(fields.researchOnly ? 1 : 0);
        }
        if (fields.learnings !== undefined) {
          updates.push('learnings = ?');
          values.push(JSON.stringify(fields.learnings));
        }

        if (updates.length > 0) {
          updates.push('updated_at = ?');
          values.push(Date.now());
          values.push(storyId);
          d.query(`UPDATE prd_stories SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        }

        const updated = d.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
        return {
          content: [{ type: 'text', text: JSON.stringify(storyFromRow(updated), null, 2) }],
        };
      }

      case 'delete_story': {
        // Remove this story from other stories' dependsOn lists
        const allStories = d.query('SELECT id, depends_on FROM prd_stories').all() as any[];
        for (const s of allStories) {
          const deps = JSON.parse(s.depends_on || '[]');
          if (deps.includes(args.storyId)) {
            const newDeps = deps.filter((d: string) => d !== args.storyId);
            d.query('UPDATE prd_stories SET depends_on = ? WHERE id = ?').run(
              JSON.stringify(newDeps),
              s.id,
            );
          }
        }
        d.query('DELETE FROM prd_stories WHERE id = ?').run(args.storyId);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      }

      case 'reorder_stories': {
        const { storyIds } = args;
        for (let i = 0; i < storyIds.length; i++) {
          d.query('UPDATE prd_stories SET sort_order = ?, updated_at = ? WHERE id = ?').run(
            i,
            Date.now(),
            storyIds[i],
          );
        }
        return {
          content: [
            { type: 'text', text: JSON.stringify({ ok: true, reordered: storyIds.length }) },
          ],
        };
      }

      case 'archive_completed_stories': {
        let result: any;
        if (args.prdId) {
          result = d
            .query(
              "UPDATE prd_stories SET status = 'archived', updated_at = ? WHERE prd_id = ? AND status = 'completed'",
            )
            .run(Date.now(), args.prdId);
        } else if (args.workspacePath) {
          result = d
            .query(
              "UPDATE prd_stories SET status = 'archived', updated_at = ? WHERE prd_id IS NULL AND workspace_path = ? AND status = 'completed'",
            )
            .run(Date.now(), args.workspacePath);
        } else {
          return error('Either workspacePath or prdId is required');
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, archived: result.changes }) }],
        };
      }

      // ── Bulk Operations ──

      case 'batch_create_stories': {
        const now = Date.now();
        const prdId = args.prdId || null;
        const workspacePath = args.workspacePath || null;

        // Get current max sort_order
        let maxRow: any;
        if (prdId) {
          maxRow = d
            .query('SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id = ?')
            .get(prdId);
        } else {
          maxRow = d
            .query(
              'SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ?',
            )
            .get(workspacePath);
        }
        let sortOrder = (maxRow?.max_order ?? -1) + 1;

        const insert = d.query(
          `INSERT INTO prd_stories (
            id, prd_id, workspace_path, title, description, acceptance_criteria,
            priority, depends_on, dependency_reasons, status, research_only,
            attempts, max_attempts, learnings, sort_order, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'pending', ?, 0, 3, '[]', ?, ?, ?)`,
        );

        const createdIds: string[] = [];
        for (const s of args.stories) {
          const id = nanoid(12);
          createdIds.push(id);
          const criteria = (s.acceptanceCriteria || []).map((desc: string) => ({
            id: nanoid(6),
            description: desc,
            passed: false,
          }));
          insert.run(
            id,
            prdId,
            workspacePath,
            s.title,
            s.description || '',
            JSON.stringify(criteria),
            s.priority || 'medium',
            JSON.stringify(s.dependsOn || []),
            s.researchOnly ? 1 : 0,
            sortOrder++,
            now,
            now,
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, storyIds: createdIds, count: createdIds.length }),
            },
          ],
        };
      }

      case 'batch_update_stories': {
        const results: any[] = [];
        for (const update of args.updates) {
          // Reuse single-update logic inline
          const { storyId, ...fields } = update;
          const existing = d.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
          if (!existing) {
            results.push({ storyId, error: 'not found' });
            continue;
          }

          const ups: string[] = [];
          const vals: any[] = [];
          if (fields.title !== undefined) {
            ups.push('title = ?');
            vals.push(fields.title);
          }
          if (fields.description !== undefined) {
            ups.push('description = ?');
            vals.push(fields.description);
          }
          if (fields.status !== undefined) {
            ups.push('status = ?');
            vals.push(fields.status);
          }
          if (fields.priority !== undefined) {
            ups.push('priority = ?');
            vals.push(fields.priority);
          }
          if (fields.acceptanceCriteria !== undefined) {
            const criteria = fields.acceptanceCriteria.map((desc: string) => ({
              id: nanoid(6),
              description: desc,
              passed: false,
            }));
            ups.push('acceptance_criteria = ?');
            vals.push(JSON.stringify(criteria));
          }
          if (fields.dependsOn !== undefined) {
            ups.push('depends_on = ?');
            vals.push(JSON.stringify(fields.dependsOn));
          }
          if (fields.researchOnly !== undefined) {
            ups.push('research_only = ?');
            vals.push(fields.researchOnly ? 1 : 0);
          }
          if (fields.learnings !== undefined) {
            ups.push('learnings = ?');
            vals.push(JSON.stringify(fields.learnings));
          }

          if (ups.length > 0) {
            ups.push('updated_at = ?');
            vals.push(Date.now());
            vals.push(storyId);
            d.query(`UPDATE prd_stories SET ${ups.join(', ')} WHERE id = ?`).run(...vals);
          }
          results.push({ storyId, ok: true });
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ results }) }],
        };
      }

      // ── Loop Management ──

      case 'list_loops': {
        let rows: any[];
        if (args.status) {
          rows = d
            .query('SELECT * FROM loops WHERE status = ? ORDER BY created_at DESC')
            .all(args.status) as any[];
        } else {
          rows = d.query('SELECT * FROM loops ORDER BY created_at DESC LIMIT 20').all() as any[];
        }
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
      }

      case 'get_loop': {
        const row = d.query('SELECT * FROM loops WHERE id = ?').get(args.loopId);
        if (!row) return error(`Loop not found: ${args.loopId}`);
        return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] };
      }

      default:
        return error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return error(`Tool execution error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function error(message: string) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ── JSON-RPC stdio Protocol ──

function send(obj: any) {
  const json = JSON.stringify(obj);
  process.stdout.write(json + '\n');
}

const rl = createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  let request: any;
  try {
    request = JSON.parse(line);
  } catch {
    return; // Ignore malformed input
  }

  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'e-work', version: '1.0.0' },
        },
      });
      break;

    case 'notifications/initialized':
      // Client acknowledgement — no response needed
      break;

    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      });
      break;

    case 'tools/call': {
      const { name, arguments: args } = params;
      const result = await handleToolCall(name, args || {});
      send({
        jsonrpc: '2.0',
        id,
        result,
      });
      break;
    }

    default:
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
  }
});

// Keep alive until stdin closes
rl.on('close', () => {
  if (db) db.close();
  process.exit(0);
});
