import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';

const app = new Hono();

// List project memories for a given project path
app.get('/', (c) => {
  const projectPath = c.req.query('projectPath');
  if (!projectPath) return c.json({ ok: false, error: 'projectPath required' }, 400);

  const db = getDb();
  const category = c.req.query('category');

  let rows: any[];
  if (category) {
    rows = db
      .query(
        `SELECT * FROM project_memories WHERE project_path = ? AND category = ? ORDER BY times_seen DESC, updated_at DESC`,
      )
      .all(projectPath, category);
  } else {
    rows = db
      .query(
        `SELECT * FROM project_memories WHERE project_path = ? ORDER BY times_seen DESC, updated_at DESC`,
      )
      .all(projectPath);
  }

  return c.json({
    ok: true,
    data: rows.map(toApiShape),
  });
});

// Create a new memory
app.post('/', async (c) => {
  const body = await c.req.json();
  const { projectPath, category, key, content, source, confidence } = body;

  if (!projectPath || !key || !content) {
    return c.json({ ok: false, error: 'projectPath, key, and content are required' }, 400);
  }

  const db = getDb();

  // Check for existing memory with same project+key — merge if auto-extracted
  const existing = db
    .query(`SELECT * FROM project_memories WHERE project_path = ? AND key = ?`)
    .get(projectPath, key) as any;

  if (existing) {
    // Reinforce existing memory
    db.query(
      `UPDATE project_memories SET content = ?, times_seen = times_seen + 1, confidence = MIN(1.0, confidence + 0.1), updated_at = ? WHERE id = ?`,
    ).run(content, Date.now(), existing.id);
    const updated = db.query(`SELECT * FROM project_memories WHERE id = ?`).get(existing.id);
    return c.json({ ok: true, data: toApiShape(updated as any) });
  }

  const id = nanoid();
  const now = Date.now();
  db.query(
    `INSERT INTO project_memories (id, project_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    id,
    projectPath,
    category || 'convention',
    key,
    content,
    source || 'manual',
    confidence ?? 1.0,
    now,
    now,
  );

  return c.json({ ok: true, data: { id } }, 201);
});

// Search memories by content or key
app.get('/search/query', (c) => {
  const projectPath = c.req.query('projectPath');
  const q = c.req.query('q');
  if (!projectPath || !q) return c.json({ ok: false, error: 'projectPath and q required' }, 400);

  const db = getDb();
  const rows = db
    .query(
      `SELECT * FROM project_memories WHERE project_path = ? AND (key LIKE ? OR content LIKE ?) ORDER BY times_seen DESC, confidence DESC LIMIT 50`,
    )
    .all(projectPath, `%${q}%`, `%${q}%`);

  return c.json({ ok: true, data: rows.map(toApiShape) });
});

// Get memories formatted for system prompt injection
app.get('/context', (c) => {
  const projectPath = c.req.query('projectPath');
  if (!projectPath) return c.json({ ok: false, error: 'projectPath required' }, 400);

  const db = getDb();
  // Get high-confidence memories, sorted by relevance
  const rows = db
    .query(
      `SELECT * FROM project_memories WHERE project_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC, confidence DESC LIMIT 100`,
    )
    .all(projectPath) as any[];

  if (rows.length === 0) {
    return c.json({ ok: true, data: { context: '', count: 0 } });
  }

  // Format for system prompt
  const grouped: Record<string, string[]> = {};
  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push(`- ${row.key}: ${row.content}`);
  }

  const categoryLabels: Record<string, string> = {
    convention: 'Coding Conventions',
    decision: 'Architecture Decisions',
    preference: 'User Preferences',
    pattern: 'Common Patterns',
    context: 'Project Context',
  };

  let context = '## Project Memory\n\n';
  for (const [cat, items] of Object.entries(grouped)) {
    context += `### ${categoryLabels[cat] || cat}\n${items.join('\n')}\n\n`;
  }

  return c.json({ ok: true, data: { context: context.trim(), count: rows.length } });
});

// Get a single memory (MUST come after /search/query and /context to avoid /:id catching them)
app.get('/:id', (c) => {
  const db = getDb();
  const row = db.query(`SELECT * FROM project_memories WHERE id = ?`).get(c.req.param('id'));
  if (!row) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: toApiShape(row as any) });
});

// Update a memory
app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const db = getDb();

  const existing = db.query(`SELECT * FROM project_memories WHERE id = ?`).get(id);
  if (!existing) return c.json({ ok: false, error: 'Not found' }, 404);

  const updates: string[] = [];
  const values: any[] = [];

  for (const field of ['category', 'key', 'content', 'confidence'] as const) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(body[field]);
    }
  }

  if (updates.length === 0) return c.json({ ok: false, error: 'No fields to update' }, 400);

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  db.query(`UPDATE project_memories SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return c.json({ ok: true });
});

// Delete a memory
app.delete('/:id', (c) => {
  const db = getDb();
  const result = db.query(`DELETE FROM project_memories WHERE id = ?`).run(c.req.param('id'));
  if (result.changes === 0) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// Bulk extract endpoint — receives conversation text and extracts memories
app.post('/extract', async (c) => {
  const body = await c.req.json();
  const { projectPath, messages } = body;

  if (!projectPath || !messages || !Array.isArray(messages)) {
    return c.json({ ok: false, error: 'projectPath and messages[] required' }, 400);
  }

  const extracted = extractMemories(messages);
  const db = getDb();
  const created: string[] = [];

  for (const mem of extracted) {
    // Check if this memory already exists
    const existing = db
      .query(`SELECT * FROM project_memories WHERE project_path = ? AND key = ?`)
      .get(projectPath, mem.key) as any;

    if (existing) {
      // Reinforce
      db.query(
        `UPDATE project_memories SET times_seen = times_seen + 1, confidence = MIN(1.0, confidence + 0.05), updated_at = ? WHERE id = ?`,
      ).run(Date.now(), existing.id);
    } else {
      const id = nanoid();
      const now = Date.now();
      db.query(
        `INSERT INTO project_memories (id, project_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'auto', ?, 1, ?, ?)`,
      ).run(id, projectPath, mem.category, mem.key, mem.content, mem.confidence, now, now);
      created.push(id);
    }
  }

  return c.json({ ok: true, data: { extracted: extracted.length, created: created.length } });
});

function toApiShape(row: any) {
  return {
    id: row.id,
    projectPath: row.project_path,
    category: row.category,
    key: row.key,
    content: row.content,
    source: row.source,
    confidence: row.confidence,
    timesSeen: row.times_seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Simple pattern-based memory extraction from conversation messages
function extractMemories(
  messages: Array<{ role: string; content: string }>,
): Array<{ category: string; key: string; content: string; confidence: number }> {
  const memories: Array<{ category: string; key: string; content: string; confidence: number }> =
    [];
  const fullText = messages.map((m) => m.content).join('\n');

  // Detect coding conventions
  const conventionPatterns = [
    {
      pattern: /(?:always|we|prefer|convention|standard)\s+use\s+(\w+[\w\s]*\w+)/gi,
      category: 'convention',
      confidence: 0.6,
    },
    {
      pattern: /(?:naming convention|naming style)[\s:]+(\w+[\w\s]*\w+)/gi,
      category: 'convention',
      confidence: 0.7,
    },
    {
      pattern: /(?:use|using|prefer)\s+(single|double)\s+quotes/gi,
      category: 'convention',
      confidence: 0.7,
    },
    {
      pattern: /(?:indent|indentation)\s+(?:with|using|is)\s+(\d+\s+spaces?|tabs?)/gi,
      category: 'convention',
      confidence: 0.7,
    },
  ];

  // Detect architecture decisions
  const decisionPatterns = [
    {
      pattern: /(?:decided|chose|we're using|switched to|migrated? to)\s+(\w+[\w\s/.-]*\w+)/gi,
      category: 'decision',
      confidence: 0.6,
    },
    {
      pattern: /(?:architecture|pattern)[\s:]+(\w+[\w\s]*\w+)/gi,
      category: 'decision',
      confidence: 0.5,
    },
  ];

  // Detect preferences
  const preferencePatterns = [
    {
      pattern: /(?:don'?t|never|avoid|do not)\s+(?:use|add|include)\s+(\w+[\w\s]*\w+)/gi,
      category: 'preference',
      confidence: 0.6,
    },
    {
      pattern: /(?:always|make sure to|remember to)\s+(\w+[\w\s]*\w+)/gi,
      category: 'preference',
      confidence: 0.5,
    },
  ];

  const allPatterns = [...conventionPatterns, ...decisionPatterns, ...preferencePatterns];

  for (const { pattern, category, confidence } of allPatterns) {
    let match;
    while ((match = pattern.exec(fullText)) !== null) {
      const value = match[1].trim();
      if (value.length > 3 && value.length < 200) {
        memories.push({
          category,
          key: value.slice(0, 80),
          content: match[0].trim(),
          confidence,
        });
      }
    }
  }

  // Deduplicate by key
  const seen = new Set<string>();
  return memories.filter((m) => {
    const k = m.key.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export { app as projectMemoryRoutes };
