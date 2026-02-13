import { Hono } from 'hono';
import { upgradeWebSocket } from '../ws';
import { getLspCommand, getAvailableServers, getInstallInfo } from '../services/lsp-registry';
import type { Subprocess } from 'bun';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const lspRoutes = new Hono();

const LSP_DIR = join(homedir(), '.maude', 'lsp');

// REST: list available language servers
lspRoutes.get('/servers', async (c) => {
  const servers = await getAvailableServers();
  return c.json({ ok: true, data: servers });
});

// POST: install an npm-based language server into ~/.maude/lsp/
lspRoutes.post('/install', async (c) => {
  const body = await c.req.json<{ language: string }>();
  const { language } = body;

  const info = getInstallInfo(language);
  if (!info?.npmPackage) {
    return c.json({ ok: false, error: `No npm package available for language: ${language}` }, 404);
  }

  // Ensure ~/.maude/lsp/ exists with a package.json
  mkdirSync(LSP_DIR, { recursive: true });
  const pkgJsonPath = join(LSP_DIR, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    writeFileSync(pkgJsonPath, JSON.stringify({ private: true }, null, 2));
  }

  const packages = info.npmPackage.split(' ');

  try {
    const proc = Bun.spawn(['npm', 'install', '--prefix', LSP_DIR, ...packages], {
      cwd: LSP_DIR,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;

    if (exitCode === 0) {
      return c.json({ ok: true });
    }

    const stderr = proc.stderr ? await new Response(proc.stderr).text() : '';
    return c.json({ ok: false, error: `npm install failed (exit ${exitCode}): ${stderr.trim()}` }, 500);
  } catch (err) {
    return c.json({ ok: false, error: `Failed to run npm install: ${err}` }, 500);
  }
});

// GET: check which languages have managed installs in ~/.maude/lsp/
lspRoutes.get('/install-status', async (c) => {
  const servers = await getAvailableServers();
  const binDir = join(LSP_DIR, 'node_modules', '.bin');

  const installed: Record<string, boolean> = {};
  for (const server of servers) {
    if (server.installable) {
      installed[server.language] = existsSync(join(binDir, server.command));
    }
  }

  return c.json({ ok: true, data: installed });
});

/**
 * Parse LSP JSON-RPC messages from a stdio stream.
 * Protocol: `Content-Length: N\r\n\r\n{...json...}`
 */
function createLspParser(onMessage: (msg: any) => void) {
  let buffer = '';
  let contentLength = -1;

  return {
    feed(chunk: string) {
      buffer += chunk;

      while (true) {
        if (contentLength < 0) {
          // Look for the header
          const headerEnd = buffer.indexOf('\r\n\r\n');
          if (headerEnd < 0) break;

          const header = buffer.slice(0, headerEnd);
          const match = header.match(/Content-Length:\s*(\d+)/i);
          if (!match) {
            // Skip malformed header
            buffer = buffer.slice(headerEnd + 4);
            continue;
          }

          contentLength = parseInt(match[1], 10);
          buffer = buffer.slice(headerEnd + 4);
        }

        // Check if we have enough bytes for the body
        if (buffer.length < contentLength) break;

        const body = buffer.slice(0, contentLength);
        buffer = buffer.slice(contentLength);
        contentLength = -1;

        try {
          onMessage(JSON.parse(body));
        } catch {
          // Skip malformed JSON
        }
      }
    },
  };
}

/**
 * Encode a JSON-RPC message with Content-Length header for LSP stdio.
 */
function encodeLspMessage(msg: any): string {
  const body = JSON.stringify(msg);
  return `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`;
}

// WebSocket: bridge between client and language server process
lspRoutes.get(
  '/ws',
  upgradeWebSocket((c) => {
    const language = c.req.query('language') || '';
    const rootPath = c.req.query('rootPath') || '.';

    let lsProcess: Subprocess | null = null;

    return {
      onOpen(_event, ws) {
        const entry = getLspCommand(language);
        if (!entry) {
          ws.send(JSON.stringify({ error: `No language server for: ${language}` }));
          ws.close(1008, 'unsupported language');
          return;
        }

        try {
          lsProcess = Bun.spawn([entry.command, ...entry.args], {
            cwd: rootPath,
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
          });
        } catch (err) {
          ws.send(JSON.stringify({ error: `Failed to spawn ${entry.command}: ${err}` }));
          ws.close(1011, 'spawn failed');
          return;
        }

        // Read stdout and parse LSP messages
        const parser = createLspParser((msg) => {
          try {
            ws.send(JSON.stringify(msg));
          } catch {
            // WebSocket closed
          }
        });

        const stdout = lsProcess.stdout;
        if (stdout && typeof stdout !== 'number') {
          (async () => {
            const reader = (stdout as ReadableStream<Uint8Array>).getReader();
            const decoder = new TextDecoder();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                parser.feed(decoder.decode(value, { stream: true }));
              }
            } catch {
              // Process exited or stream closed
            }
          })();
        }

        // Log stderr
        const stderr = lsProcess.stderr;
        if (stderr && typeof stderr !== 'number') {
          (async () => {
            const reader = (stderr as ReadableStream<Uint8Array>).getReader();
            const decoder = new TextDecoder();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value, { stream: true });
                console.warn(`[LSP ${language}] stderr:`, text.trim());
              }
            } catch {
              // Stream closed
            }
          })();
        }
      },

      onMessage(event, _ws) {
        const stdin = lsProcess?.stdin;
        if (!stdin || typeof stdin === 'number') return;

        // Client sends JSON-RPC messages; forward them to the LS stdin with framing
        const data =
          typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer);
        try {
          const msg = JSON.parse(data);
          const encoded = encodeLspMessage(msg);
          (stdin as import('bun').FileSink).write(encoded);
        } catch {
          // Ignore malformed messages
        }
      },

      onClose() {
        if (lsProcess) {
          const stdin = lsProcess.stdin;
          const writeTo = (msg: string) => {
            if (stdin && typeof stdin !== 'number') {
              (stdin as import('bun').FileSink).write(msg);
            }
          };

          // Send shutdown request then exit notification
          try {
            writeTo(
              encodeLspMessage({
                jsonrpc: '2.0',
                id: 'shutdown',
                method: 'shutdown',
                params: null,
              }),
            );

            setTimeout(() => {
              try {
                writeTo(
                  encodeLspMessage({
                    jsonrpc: '2.0',
                    method: 'exit',
                  }),
                );
              } catch {}

              setTimeout(() => {
                try {
                  lsProcess?.kill();
                } catch {}
                lsProcess = null;
              }, 500);
            }, 500);
          } catch {
            try {
              lsProcess.kill();
            } catch {}
            lsProcess = null;
          }
        }
      },

      onError() {
        if (lsProcess) {
          try {
            lsProcess.kill();
          } catch {}
          lsProcess = null;
        }
      },
    };
  }),
);
