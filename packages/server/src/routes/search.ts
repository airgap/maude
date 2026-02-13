import { Hono } from 'hono';
import { readFile, readdir, stat } from 'fs/promises';
import { join, relative } from 'path';

interface SearchMatch {
  file: string;
  relativePath: string;
  line: number;
  column: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.svelte-kit',
  '__pycache__',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  'target',
]);

const BINARY_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wasm',
]);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

const app = new Hono();

app.get('/', async (c) => {
  const query = c.req.query('q');
  const rootPath = c.req.query('path') || process.cwd();
  const isRegex = c.req.query('regex') === 'true';
  const limit = Math.min(parseInt(c.req.query('limit') || '500'), 2000);

  if (!query) return c.json({ ok: false, error: 'q parameter required' }, 400);

  let pattern: RegExp;
  try {
    pattern = isRegex
      ? new RegExp(query, 'gi')
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  } catch (err) {
    return c.json({ ok: false, error: `Invalid regex: ${err}` }, 400);
  }

  const results: SearchMatch[] = [];
  let totalMatches = 0;
  let fileCount = 0;
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (truncated) return;

      if (entry.name.startsWith('.') && entry.name !== '.claude') continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(fullPath);
      } else {
        const ext = '.' + (entry.name.split('.').pop()?.toLowerCase() ?? '');
        if (BINARY_EXTS.has(ext)) continue;

        let fileStat;
        try {
          fileStat = await stat(fullPath);
        } catch {
          continue;
        }
        if (fileStat.size > MAX_FILE_SIZE) continue;

        let content: string;
        try {
          content = await readFile(fullPath, 'utf-8');
        } catch {
          continue;
        }

        const lines = content.split('\n');
        let fileHasMatch = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(line)) !== null) {
            if (!fileHasMatch) {
              fileHasMatch = true;
              fileCount++;
            }
            totalMatches++;
            if (results.length < limit) {
              results.push({
                file: fullPath,
                relativePath: relative(rootPath, fullPath),
                line: i + 1,
                column: match.index + 1,
                content: line.length > 500 ? line.slice(0, 500) : line,
                matchStart: match.index,
                matchEnd: match.index + match[0].length,
              });
            } else {
              truncated = true;
              return;
            }
          }
        }
      }
    }
  }

  await walk(rootPath);

  return c.json({
    ok: true,
    data: { results, totalMatches, fileCount, truncated },
  });
});

export { app as searchRoutes };
