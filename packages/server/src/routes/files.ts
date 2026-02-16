import { Hono } from 'hono';
import { readFile, readdir, stat, writeFile, mkdir, unlink, rename } from 'fs/promises';
import { join, relative, dirname } from 'path';
import { homedir } from 'os';
import editorconfig from 'editorconfig';
import type { EditorConfigProps } from '@maude/shared';

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

// Write file
app.put('/write', async (c) => {
  const body = await c.req.json();
  const { path: filePath, content } = body;
  if (!filePath) return c.json({ ok: false, error: 'path required' }, 400);
  if (typeof content !== 'string') return c.json({ ok: false, error: 'content required' }, 400);

  try {
    // Ensure parent directory exists
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Create file
app.post('/create', async (c) => {
  const body = await c.req.json();
  const { path: filePath, content = '' } = body;
  if (!filePath) return c.json({ ok: false, error: 'path required' }, 400);

  try {
    // Check if file already exists
    try {
      await stat(filePath);
      return c.json({ ok: false, error: 'File already exists' }, 409);
    } catch {
      // File doesn't exist, good
    }
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Delete file
app.delete('/delete', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ ok: false, error: 'path required' }, 400);

  try {
    await unlink(filePath);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Rename/move file
app.post('/rename', async (c) => {
  const body = await c.req.json();
  const { oldPath, newPath } = body;
  if (!oldPath || !newPath)
    return c.json({ ok: false, error: 'oldPath and newPath required' }, 400);

  try {
    await mkdir(dirname(newPath), { recursive: true });
    await rename(oldPath, newPath);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Resolve .editorconfig for a file path
app.get('/editorconfig', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ ok: false, error: 'path required' }, 400);

  try {
    const raw = await editorconfig.parse(filePath);
    const config: EditorConfigProps = {};

    if (raw.indent_style === 'tab' || raw.indent_style === 'space') {
      config.indent_style = raw.indent_style as 'tab' | 'space';
    }
    if (raw.indent_size !== undefined && raw.indent_size !== 'tab') {
      config.indent_size = Number(raw.indent_size);
    }
    if (raw.tab_width !== undefined) {
      config.tab_width = Number(raw.tab_width);
    }
    if (raw.end_of_line === 'lf' || raw.end_of_line === 'crlf' || raw.end_of_line === 'cr') {
      config.end_of_line = raw.end_of_line as 'lf' | 'crlf' | 'cr';
    }
    if (raw.trim_trailing_whitespace !== undefined) {
      config.trim_trailing_whitespace =
        raw.trim_trailing_whitespace === true || raw.trim_trailing_whitespace === 'true';
    }
    if (raw.insert_final_newline !== undefined) {
      config.insert_final_newline =
        raw.insert_final_newline === true || raw.insert_final_newline === 'true';
    }
    if (raw.charset) {
      config.charset = String(raw.charset);
    }

    return c.json({ ok: true, data: config });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Verify file (syntax check)
app.post('/verify', async (c) => {
  const body = await c.req.json<{ path: string; workspacePath?: string }>();
  const { path: filePath, workspacePath } = body;

  if (!filePath) return c.json({ ok: false, error: 'path required' }, 400);

  try {
    const { verifyFile } = await import('../services/code-verifier');
    const result = await verifyFile(filePath, workspacePath || process.cwd());
    return c.json({ ok: true, data: result });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export { app as fileRoutes };
