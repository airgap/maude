import { Hono } from 'hono';

const app = new Hono();

// Git status
app.get('/status', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();

  try {
    const proc = Bun.spawn(['git', 'status', '--porcelain', '-uall'], {
      cwd: rootPath,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return c.json({ ok: true, data: { isRepo: false, files: [] } });
    }

    const files = output
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const xy = line.slice(0, 2);
        const filePath = line.slice(3).trim();
        // Parse two-letter status code
        let status: string;
        const x = xy[0];
        const y = xy[1];

        if (x === '?' && y === '?')
          status = 'U'; // untracked
        else if (x === 'A' || y === 'A')
          status = 'A'; // added
        else if (x === 'D' || y === 'D')
          status = 'D'; // deleted
        else if (x === 'M' || y === 'M')
          status = 'M'; // modified
        else if (x === 'R')
          status = 'R'; // renamed
        else status = xy.trim() || 'M';

        return {
          path: filePath,
          status,
          staged: x !== ' ' && x !== '?',
        };
      });

    return c.json({ ok: true, data: { isRepo: true, files } });
  } catch {
    return c.json({ ok: true, data: { isRepo: false, files: [] } });
  }
});

// Git branch
app.get('/branch', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();

  try {
    const proc = Bun.spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: rootPath,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return c.json({ ok: true, data: { branch: '' } });
    }

    return c.json({ ok: true, data: { branch: output.trim() } });
  } catch {
    return c.json({ ok: true, data: { branch: '' } });
  }
});

export { app as gitRoutes };
