import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

import { settingsRoutes as app } from '../settings';

function clearTables() {
  testDb.exec('DELETE FROM settings');
}

function insertSetting(key: string, value: any) {
  testDb.query('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

describe('Settings Routes', () => {
  beforeEach(() => {
    clearTables();
  });

  // ---------------------------------------------------------------
  // GET / — Get all settings
  // ---------------------------------------------------------------
  describe('GET / — get all settings', () => {
    test('returns empty object when no settings exist', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual({});
    });

    test('returns all settings as key-value map', async () => {
      insertSetting('theme', 'dark');
      insertSetting('fontSize', 14);
      insertSetting('features', { beta: true, experimental: false });

      const res = await app.request('/');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.theme).toBe('dark');
      expect(json.data.fontSize).toBe(14);
      expect(json.data.features).toEqual({ beta: true, experimental: false });
    });

    test('parses JSON values correctly for various types', async () => {
      insertSetting('string_val', 'hello');
      insertSetting('number_val', 42);
      insertSetting('bool_val', true);
      insertSetting('null_val', null);
      insertSetting('array_val', [1, 2, 3]);

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.string_val).toBe('hello');
      expect(json.data.number_val).toBe(42);
      expect(json.data.bool_val).toBe(true);
      expect(json.data.null_val).toBeNull();
      expect(json.data.array_val).toEqual([1, 2, 3]);
    });
  });

  // ---------------------------------------------------------------
  // GET /:key — Get single setting
  // ---------------------------------------------------------------
  describe('GET /:key — get single setting', () => {
    test('returns 404 for non-existent key', async () => {
      const res = await app.request('/nonexistent');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Not found');
    });

    test('returns a string setting', async () => {
      insertSetting('theme', 'dark');

      const res = await app.request('/theme');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toBe('dark');
    });

    test('returns a numeric setting', async () => {
      insertSetting('fontSize', 16);

      const res = await app.request('/fontSize');
      const json = await res.json();
      expect(json.data).toBe(16);
    });

    test('returns a boolean setting', async () => {
      insertSetting('autoSave', true);

      const res = await app.request('/autoSave');
      const json = await res.json();
      expect(json.data).toBe(true);
    });

    test('returns an object setting', async () => {
      insertSetting('keybindings', { save: 'ctrl+s', quit: 'ctrl+q' });

      const res = await app.request('/keybindings');
      const json = await res.json();
      expect(json.data).toEqual({ save: 'ctrl+s', quit: 'ctrl+q' });
    });

    test('returns an array setting', async () => {
      insertSetting('recentFiles', ['/a.ts', '/b.ts']);

      const res = await app.request('/recentFiles');
      const json = await res.json();
      expect(json.data).toEqual(['/a.ts', '/b.ts']);
    });
  });

  // ---------------------------------------------------------------
  // PATCH / — Update/merge settings
  // ---------------------------------------------------------------
  describe('PATCH / — update settings', () => {
    test('creates new settings', async () => {
      const res = await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ theme: 'light', fontSize: 12 }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      // Verify in DB
      const row1 = testDb.query('SELECT value FROM settings WHERE key = ?').get('theme') as any;
      expect(JSON.parse(row1.value)).toBe('light');
      const row2 = testDb.query('SELECT value FROM settings WHERE key = ?').get('fontSize') as any;
      expect(JSON.parse(row2.value)).toBe(12);
    });

    test('upserts (overwrites) existing settings', async () => {
      insertSetting('theme', 'dark');

      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ theme: 'light' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('theme') as any;
      expect(JSON.parse(row.value)).toBe('light');
    });

    test('accepts body wrapped in settings key', async () => {
      const res = await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ settings: { lang: 'en', zoom: 1.5 } }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);

      const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('lang') as any;
      expect(JSON.parse(row.value)).toBe('en');
      const row2 = testDb.query('SELECT value FROM settings WHERE key = ?').get('zoom') as any;
      expect(JSON.parse(row2.value)).toBe(1.5);
    });

    test('stores complex object values', async () => {
      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ editor: { tabSize: 2, wordWrap: true } }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('editor') as any;
      expect(JSON.parse(row.value)).toEqual({ tabSize: 2, wordWrap: true });
    });

    test('stores array values', async () => {
      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ favorites: ['a', 'b', 'c'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('favorites') as any;
      expect(JSON.parse(row.value)).toEqual(['a', 'b', 'c']);
    });

    test('stores null values', async () => {
      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ removed: null }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('removed') as any;
      expect(JSON.parse(row.value)).toBeNull();
    });

    test('does not affect other existing settings', async () => {
      insertSetting('keep', 'me');
      insertSetting('change', 'old');

      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ change: 'new' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const kept = testDb.query('SELECT value FROM settings WHERE key = ?').get('keep') as any;
      expect(JSON.parse(kept.value)).toBe('me');
      const changed = testDb.query('SELECT value FROM settings WHERE key = ?').get('change') as any;
      expect(JSON.parse(changed.value)).toBe('new');
    });

    test('handles multiple settings in one request', async () => {
      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ a: 1, b: 2, c: 3 }),
        headers: { 'Content-Type': 'application/json' },
      });

      const rows = testDb.query('SELECT * FROM settings').all() as any[];
      expect(rows).toHaveLength(3);
    });

    test('updated settings are visible via GET', async () => {
      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ theme: 'solarized' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await app.request('/theme');
      const json = await res.json();
      expect(json.data).toBe('solarized');
    });
  });
});
