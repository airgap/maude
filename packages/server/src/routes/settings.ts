import { Hono } from 'hono';
import { getDb } from '../db/database';

const app = new Hono();

// Get all settings
app.get('/', (c) => {
  const db = getDb();
  const rows = db.query('SELECT * FROM settings').all() as any[];
  const settings: Record<string, any> = {};
  for (const row of rows) {
    settings[row.key] = JSON.parse(row.value);
  }
  return c.json({ ok: true, data: settings });
});

// Update settings (merge)
app.patch('/', async (c) => {
  const body = await c.req.json();
  const db = getDb();

  const upsert = db.query(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  for (const [key, value] of Object.entries(body.settings || body)) {
    upsert.run(key, JSON.stringify(value));
  }

  return c.json({ ok: true });
});

// Get single setting
app.get('/:key', (c) => {
  const db = getDb();
  const row = db.query('SELECT value FROM settings WHERE key = ?').get(c.req.param('key')) as any;
  if (!row) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: JSON.parse(row.value) });
});

export { app as settingsRoutes };
