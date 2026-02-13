import { Hono } from 'hono';
import { upgradeWebSocket } from '../ws';

let pty: typeof import('node-pty') | null = null;
try {
  // Dynamic name prevents bun's bundler from trying to embed the native .node addon
  const modName = ['node', 'pty'].join('-');
  pty = require(modName);
} catch {
  console.warn('[terminal] node-pty not available — terminal feature disabled');
}

const app = new Hono();

app.get(
  '/ws',
  upgradeWebSocket((c) => {
    const cwd = c.req.query('cwd') || process.env.HOME || '/';
    const cols = parseInt(c.req.query('cols') || '80');
    const rows = parseInt(c.req.query('rows') || '24');

    let term: import('node-pty').IPty | null = null;

    return {
      onOpen(_evt, ws) {
        if (!pty) {
          ws.send('\r\n[Terminal unavailable: native pty module not loaded]\r\n');
          ws.close(1011, 'pty not available');
          return;
        }
        try {
          term = pty.spawn(process.env.SHELL || '/bin/bash', [], {
            name: 'xterm-256color',
            cols,
            rows,
            cwd,
            env: process.env as Record<string, string>,
          });

          term.onData((data: string) => {
            try {
              ws.send(data);
            } catch {
              // WebSocket may be closed
            }
          });

          term.onExit(() => {
            try {
              ws.close();
            } catch {
              // Already closed
            }
          });
        } catch (err) {
          console.error('Failed to spawn PTY:', err);
          ws.close();
        }
      },

      onMessage(evt, _ws) {
        if (!term) return;
        const data =
          typeof evt.data === 'string'
            ? evt.data
            : new TextDecoder().decode(evt.data as ArrayBuffer);

        // Resize command: prefixed with \x01
        if (data.startsWith('\x01')) {
          const parts = data.slice(1).split(',');
          if (parts.length === 2) {
            const newCols = parseInt(parts[0]);
            const newRows = parseInt(parts[1]);
            if (newCols > 0 && newRows > 0) {
              term.resize(newCols, newRows);
            }
          }
          return;
        }

        term.write(data);
      },

      onClose() {
        if (term) {
          term.kill();
          term = null;
        }
      },

      onError() {
        if (term) {
          term.kill();
          term = null;
        }
      },
    };
  }),
);

export { app as terminalRoutes };
