import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { conversationRoutes } from './routes/conversations';
import { streamRoutes } from './routes/stream';
import { toolRoutes } from './routes/tools';
import { taskRoutes } from './routes/tasks';
import { settingsRoutes } from './routes/settings';
import { mcpRoutes } from './routes/mcp';
import { memoryRoutes } from './routes/memory';
import { agentRoutes } from './routes/agents';
import { fileRoutes } from './routes/files';
import { commandRoutes } from './routes/commands';
import { projectRoutes } from './routes/projects';
import { searchRoutes } from './routes/search';
import { gitRoutes } from './routes/git';
import { terminalRoutes } from './routes/terminal';
import { lspRoutes } from './routes/lsp';
import { authRoutes } from './routes/auth';
import { projectMemoryRoutes } from './routes/project-memory';
import { authMiddleware } from './middleware/auth';
import { websocket } from './ws';
import { initDatabase } from './db/database';
import { existsSync } from 'fs';
import { resolve } from 'path';

const app = new Hono();

// Middleware
app.use(
  '*',
  cors({
    origin: (origin) => {
      // No origin: same-origin request, Tauri on Linux (webkit sends empty origin), or tools
      if (!origin) return '*';
      // Allow any localhost port (dev mode, Tauri on other platforms)
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin;
      if (origin === 'tauri://localhost' || origin === 'https://tauri.localhost') return origin;
      return null;
    },
  }),
);
app.use('*', logger());

// Auth middleware (no-op in single-user mode)
app.use('/api/*', authMiddleware);

// Health check
app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }));

// API routes
app.route('/api/conversations', conversationRoutes);
app.route('/api/stream', streamRoutes);
app.route('/api/tools', toolRoutes);
app.route('/api/tasks', taskRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/mcp', mcpRoutes);
app.route('/api/memory', memoryRoutes);
app.route('/api/agents', agentRoutes);
app.route('/api/files', fileRoutes);
app.route('/api/commands', commandRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/git', gitRoutes);
app.route('/api/terminal', terminalRoutes);
app.route('/api/lsp', lspRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/project-memory', projectMemoryRoutes);

// Initialize database
initDatabase();

// Serve static client build when available (for `bun run start` single-process mode)
const clientBuildPath = process.env.CLIENT_DIST || resolve(import.meta.dir, '../../client/build');
if (existsSync(clientBuildPath)) {
  app.use('*', serveStatic({ root: clientBuildPath, rewriteRequestPath: (path) => path }));
  // SPA fallback — serve index.html for non-API, non-file routes
  app.get('*', async (c) => {
    const file = Bun.file(resolve(clientBuildPath, 'index.html'));
    return c.html(await file.text());
  });
  console.log(`Serving client from ${clientBuildPath}`);
}

const requestedPort = process.env.PORT !== undefined ? Number(process.env.PORT) : 3002;

if (requestedPort === 0) {
  // Dynamic port mode (used by Tauri sidecar) — use Bun.serve directly
  const server = Bun.serve({
    port: 0,
    fetch: app.fetch,
    websocket,
    idleTimeout: 120,
  });
  // Machine-parseable line for Tauri to read the actual port
  console.log(`MAUDE_PORT=${server.port}`);
  console.log(`Maude server running on http://localhost:${server.port}`);
} else {
  console.log(`MAUDE_PORT=${requestedPort}`);
  console.log(`Maude server running on http://localhost:${requestedPort}`);
}

// Used by Bun's module loader when requestedPort !== 0 (supports --hot reload in dev)
export default requestedPort !== 0
  ? { port: requestedPort, fetch: app.fetch, websocket, idleTimeout: 120 }
  : undefined;
