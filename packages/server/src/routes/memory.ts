import { Hono } from 'hono';
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';

const app = new Hono();

// Get all memory files
app.get('/', async (c) => {
  const projectPath = c.req.query('projectPath') || process.cwd();
  const files = [];

  // Project memory
  for (const p of ['CLAUDE.md', '.claude/CLAUDE.md']) {
    const full = join(projectPath, p);
    try {
      const content = await readFile(full, 'utf-8');
      const s = await stat(full);
      files.push({ path: full, content, type: 'project', lastModified: s.mtimeMs });
    } catch {
      // File does not exist, skip
    }
  }

  // Local memory
  const localPath = join(projectPath, 'CLAUDE.local.md');
  try {
    const content = await readFile(localPath, 'utf-8');
    const s = await stat(localPath);
    files.push({ path: localPath, content, type: 'project-local', lastModified: s.mtimeMs });
  } catch {
    // File does not exist, skip
  }

  // User memory
  const userPath = join(homedir(), '.claude', 'CLAUDE.md');
  try {
    const content = await readFile(userPath, 'utf-8');
    const s = await stat(userPath);
    files.push({ path: userPath, content, type: 'user', lastModified: s.mtimeMs });
  } catch {
    // File does not exist, skip
  }

  // Auto memory
  const projectName = projectPath.replace(/\//g, '-');
  const autoMemPath = join(homedir(), '.claude', 'projects', projectName, 'memory');
  try {
    const entries = await readdir(autoMemPath);
    for (const entry of entries) {
      const full = join(autoMemPath, entry);
      const content = await readFile(full, 'utf-8');
      const s = await stat(full);
      files.push({
        path: full,
        content,
        type: entry === 'MEMORY.md' ? 'auto-memory' : 'auto-topic',
        lastModified: s.mtimeMs,
      });
    }
  } catch {
    // Directory does not exist, skip
  }

  // Rules
  const rulesDir = join(projectPath, '.claude', 'rules');
  try {
    const entries = await readdir(rulesDir, { recursive: true });
    for (const entry of entries) {
      if (!String(entry).endsWith('.md')) continue;
      const full = join(rulesDir, String(entry));
      const content = await readFile(full, 'utf-8');
      const s = await stat(full);
      files.push({ path: full, content, type: 'rules', lastModified: s.mtimeMs });
    }
  } catch {
    // Directory does not exist, skip
  }

  // Skills
  const skillsDir = join(projectPath, '.claude', 'skills');
  try {
    const entries = await readdir(skillsDir);
    for (const entry of entries) {
      const skillFile = join(skillsDir, String(entry), 'SKILL.md');
      try {
        const content = await readFile(skillFile, 'utf-8');
        const s = await stat(skillFile);
        files.push({ path: skillFile, content, type: 'skills', lastModified: s.mtimeMs });
      } catch {
        // Skill file does not exist, skip
      }
    }
  } catch {
    // Directory does not exist, skip
  }

  return c.json({ ok: true, data: files });
});

// Update a memory file
app.put('/', async (c) => {
  const body = await c.req.json();
  const { path: filePath, content } = body;

  // Ensure parent directory exists
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, content, 'utf-8');

  return c.json({ ok: true });
});

export { app as memoryRoutes };
