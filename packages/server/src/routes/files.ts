import { Hono } from 'hono';
import { readFile, readdir, stat } from 'fs/promises';
import { join, relative } from 'path';
import { homedir } from 'os';

const app = new Hono();

// Read file
app.get('/read', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ ok: false, error: 'path required' }, 400);

  try {
    const content = await readFile(filePath, 'utf-8');
    const s = await stat(filePath);
    return c.json({
      ok: true,
      data: {
        path: filePath,
        content,
        size: s.size,
        lastModified: s.mtimeMs,
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 404);
  }
});

// Directory tree (for file explorer)
app.get('/tree', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();
  const depth = parseInt(c.req.query('depth') || '2');

  async function buildTree(dir: string, currentDepth: number): Promise<any[]> {
    if (currentDepth > depth) return [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const items = [];

      for (const entry of entries) {
        // Skip hidden files and common non-essential dirs
        if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
        if (['node_modules', '__pycache__', '.git', 'dist', 'build'].includes(entry.name)) continue;

        const fullPath = join(dir, entry.name);
        const relPath = relative(rootPath, fullPath);

        if (entry.isDirectory()) {
          const children = await buildTree(fullPath, currentDepth + 1);
          items.push({
            name: entry.name,
            path: fullPath,
            relativePath: relPath,
            type: 'directory',
            children,
          });
        } else {
          items.push({
            name: entry.name,
            path: fullPath,
            relativePath: relPath,
            type: 'file',
          });
        }
      }

      return items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch {
      return [];
    }
  }

  const tree = await buildTree(rootPath, 0);
  return c.json({ ok: true, data: tree });
});

// List subdirectories for directory picker
app.get('/directories', async (c) => {
  const dirPath = c.req.query('path') || homedir();

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        path: join(dirPath, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return c.json({ ok: true, data: { parent: dirPath, directories: dirs } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 400);
  }
});

export { app as fileRoutes };
