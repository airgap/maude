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

  // ---------------------------------------------------------------
  // GET / — Sensitive keys are masked
  // ---------------------------------------------------------------
  describe('GET / — sensitive key masking', () => {
    test('masks anthropicApiKey as anthropicApiKeyConfigured', async () => {
      insertSetting('anthropicApiKey', 'sk-ant-secret123');

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.anthropicApiKey).toBeUndefined();
      expect(json.data.anthropicApiKeyConfigured).toBe(true);
    });

    test('masks openaiApiKey as openaiApiKeyConfigured', async () => {
      insertSetting('openaiApiKey', 'sk-openai-secret');

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.openaiApiKey).toBeUndefined();
      expect(json.data.openaiApiKeyConfigured).toBe(true);
    });

    test('masks googleApiKey as googleApiKeyConfigured', async () => {
      insertSetting('googleApiKey', 'AIza-google-key');

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.googleApiKey).toBeUndefined();
      expect(json.data.googleApiKeyConfigured).toBe(true);
    });

    test('masks jiraConfig, linearConfig, asanaConfig', async () => {
      insertSetting('jiraConfig', { token: 'secret' });
      insertSetting('linearConfig', { apiKey: 'secret' });
      insertSetting('asanaConfig', { pat: 'secret' });

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.jiraConfig).toBeUndefined();
      expect(json.data.jiraConfigConfigured).toBe(true);
      expect(json.data.linearConfig).toBeUndefined();
      expect(json.data.linearConfigConfigured).toBe(true);
      expect(json.data.asanaConfig).toBeUndefined();
      expect(json.data.asanaConfigConfigured).toBe(true);
    });

    test('reports configured=false for falsy sensitive values', async () => {
      insertSetting('anthropicApiKey', '');

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.anthropicApiKeyConfigured).toBe(false);
    });

    test('non-sensitive settings pass through alongside masked ones', async () => {
      insertSetting('theme', 'dark');
      insertSetting('anthropicApiKey', 'sk-secret');

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.theme).toBe('dark');
      expect(json.data.anthropicApiKeyConfigured).toBe(true);
      expect(json.data.anthropicApiKey).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // PUT /api-key — Set API key (BYOK)
  // ---------------------------------------------------------------
  describe('PUT /api-key — set API key', () => {
    test('returns 400 when provider is missing', async () => {
      const res = await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ apiKey: 'sk-test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('provider and apiKey required');
    });

    test('returns 400 when apiKey is missing', async () => {
      const res = await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'anthropic' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 for unknown provider', async () => {
      const res = await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'unknown', apiKey: 'key123' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Unknown provider');
    });

    test('stores anthropic api key in settings', async () => {
      const res = await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'anthropic', apiKey: 'sk-ant-test123' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('anthropicApiKey') as any;
      expect(JSON.parse(row.value)).toBe('sk-ant-test123');
    });

    test('stores openai api key in settings', async () => {
      await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'openai', apiKey: 'sk-openai-key' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('openaiApiKey') as any;
      expect(JSON.parse(row.value)).toBe('sk-openai-key');
    });

    test('stores google api key in settings', async () => {
      await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'google', apiKey: 'AIza-google-test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('googleApiKey') as any;
      expect(JSON.parse(row.value)).toBe('AIza-google-test');
    });

    test('sets environment variable for anthropic', async () => {
      process.env.ANTHROPIC_API_KEY = undefined as unknown as string;
      await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'anthropic', apiKey: 'sk-ant-env-test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-env-test');
      delete process.env.ANTHROPIC_API_KEY;
    });

    test('overwrites existing api key', async () => {
      insertSetting('anthropicApiKey', 'old-key');

      await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'anthropic', apiKey: 'new-key' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('anthropicApiKey') as any;
      expect(JSON.parse(row.value)).toBe('new-key');
    });
  });

  // ---------------------------------------------------------------
  // GET /api-keys/status — Check API key status
  // ---------------------------------------------------------------
  describe('GET /api-keys/status — check API key status', () => {
    test('returns all providers as false when no keys configured', async () => {
      // Ensure env vars are not set
      const savedAnth = process.env.ANTHROPIC_API_KEY;
      const savedOpenai = process.env.OPENAI_API_KEY;
      const savedGoogle = process.env.GOOGLE_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const res = await app.request('/api-keys/status');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.anthropic).toBe(false);
      expect(json.data.openai).toBe(false);
      expect(json.data.google).toBe(false);

      // Restore
      if (savedAnth) process.env.ANTHROPIC_API_KEY = savedAnth;
      if (savedOpenai) process.env.OPENAI_API_KEY = savedOpenai;
      if (savedGoogle) process.env.GOOGLE_API_KEY = savedGoogle;
    });

    test('returns true for provider with key in DB', async () => {
      const savedAnth = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      insertSetting('anthropicApiKey', 'sk-test-key');

      const res = await app.request('/api-keys/status');
      const json = await res.json();
      expect(json.data.anthropic).toBe(true);

      if (savedAnth) process.env.ANTHROPIC_API_KEY = savedAnth;
    });

    test('returns true for provider with env var set', async () => {
      const saved = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-env-key';

      const res = await app.request('/api-keys/status');
      const json = await res.json();
      expect(json.data.openai).toBe(true);

      if (saved) process.env.OPENAI_API_KEY = saved;
      else delete process.env.OPENAI_API_KEY;
    });
  });

  // ---------------------------------------------------------------
  // PUT /budget — Set session budget
  // ---------------------------------------------------------------
  describe('PUT /budget — set session budget', () => {
    test('sets a budget', async () => {
      const res = await app.request('/budget', {
        method: 'PUT',
        body: JSON.stringify({ budgetUsd: 10.0 }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query("SELECT value FROM settings WHERE key = 'sessionBudgetUsd'").get() as any;
      expect(JSON.parse(row.value)).toBe(10.0);
    });

    test('clears budget when budgetUsd is null', async () => {
      insertSetting('sessionBudgetUsd', 5.0);

      const res = await app.request('/budget', {
        method: 'PUT',
        body: JSON.stringify({ budgetUsd: null }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);

      const row = testDb.query("SELECT value FROM settings WHERE key = 'sessionBudgetUsd'").get();
      expect(row).toBeNull();
    });

    test('overwrites existing budget', async () => {
      insertSetting('sessionBudgetUsd', 5.0);

      await app.request('/budget', {
        method: 'PUT',
        body: JSON.stringify({ budgetUsd: 20.0 }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query("SELECT value FROM settings WHERE key = 'sessionBudgetUsd'").get() as any;
      expect(JSON.parse(row.value)).toBe(20.0);
    });

    test('budget is retrievable via GET /:key after setting', async () => {
      await app.request('/budget', {
        method: 'PUT',
        body: JSON.stringify({ budgetUsd: 15.0 }),
        headers: { 'Content-Type': 'application/json' },
      });

      // sessionBudgetUsd key is stored, so we can read it through GET /:key
      const res = await app.request('/sessionBudgetUsd');
      const json = await res.json();
      expect(json.data).toBe(15.0);
    });
  });
});
