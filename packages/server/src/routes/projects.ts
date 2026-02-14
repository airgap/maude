import { Hono } from 'hono';
import { getDb } from '../db/database';
import { randomUUID } from 'crypto';
import { getSandboxConfig } from '../middleware/sandbox';

const app = new Hono();

// List all projects
app.get('/', (c) => {
  const db = getDb();
  const rows = db.query('SELECT * FROM projects ORDER BY last_opened DESC').all() as any[];
  const projects = rows.map((r) => ({
    id: r.id,
    name: r.name,
    path: r.path,
    lastOpened: r.last_opened,
    settings: r.settings ? JSON.parse(r.settings) : undefined,
    createdAt: r.created_at,
  }));
  return c.json({ ok: true, data: projects });
});

// Create project
app.post('/', async (c) => {
  const body = await c.req.json();
  const { name, path, settings } = body;
  if (!name || !path) return c.json({ ok: false, error: 'name and path required' }, 400);

  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  try {
    db.query(
      'INSERT INTO projects (id, name, path, last_opened, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, name, path, now, settings ? JSON.stringify(settings) : null, now);
    return c.json({ ok: true, data: { id } });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      return c.json({ ok: false, error: 'A project with this path already exists' }, 409);
    }
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Get project
app.get('/:id', (c) => {
  const db = getDb();
  const row = db.query('SELECT * FROM projects WHERE id = ?').get(c.req.param('id')) as any;
  if (!row) return c.json({ ok: false, error: 'Project not found' }, 404);

  return c.json({
    ok: true,
    data: {
      id: row.id,
      name: row.name,
      path: row.path,
      lastOpened: row.last_opened,
      settings: row.settings ? JSON.parse(row.settings) : undefined,
      createdAt: row.created_at,
    },
  });
});

// Update project
app.patch('/:id', async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const id = c.req.param('id');

  const sets: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) {
    sets.push('name = ?');
    values.push(body.name);
  }
  if (body.settings !== undefined) {
    sets.push('settings = ?');
    values.push(JSON.stringify(body.settings));
  }
  if (sets.length === 0) return c.json({ ok: true });

  values.push(id);
  db.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return c.json({ ok: true });
});

// Delete project
app.delete('/:id', (c) => {
  const db = getDb();
  const id = c.req.param('id');
  // Unlink conversations from this project
  db.query('UPDATE conversations SET project_id = NULL WHERE project_id = ?').run(id);
  db.query('DELETE FROM projects WHERE id = ?').run(id);
  return c.json({ ok: true });
});

// Open project (update last_opened timestamp)
app.post('/:id/open', (c) => {
  const db = getDb();
  db.query('UPDATE projects SET last_opened = ? WHERE id = ?').run(Date.now(), c.req.param('id'));
  return c.json({ ok: true });
});

// Get sandbox config for a project by path
app.get('/sandbox/config', (c) => {
  const projectPath = c.req.query('path');
  if (!projectPath) return c.json({ ok: false, error: 'path required' }, 400);
  const config = getSandboxConfig(projectPath);
  return c.json({ ok: true, data: config });
});

// Update sandbox config for a project
app.put('/sandbox/config', async (c) => {
  const body = await c.req.json();
  const { projectPath, enabled, allowedPaths, blockedCommands } = body;
  if (!projectPath) return c.json({ ok: false, error: 'projectPath required' }, 400);

  const db = getDb();
  const project = db.query(`SELECT * FROM projects WHERE path = ?`).get(projectPath) as any;
  if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);

  const settings = project.settings ? JSON.parse(project.settings) : {};
  settings.sandbox = {
    enabled: enabled !== undefined ? enabled : true,
    allowedPaths: allowedPaths || [projectPath],
    blockedCommands: blockedCommands || [],
  };

  db.query(`UPDATE projects SET settings = ? WHERE id = ?`).run(
    JSON.stringify(settings),
    project.id,
  );

  return c.json({ ok: true });
});

export { app as projectRoutes };
