import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  worker: {
    format: 'es',
  },
  server: {
    host: true,
    port: 3333,
    proxy: {
      // SSE streaming endpoints — disable proxy timeout and buffering
      // so the connection stays open for the full duration of the response.
      '/api/stream': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyRes', (_proxyRes, _req, res) => {
            (res as any).flushHeaders?.();
          });
        },
      },
      // Git commit/push streams can be long-lived (pre-commit hooks may run
      // typecheck, tests, etc.) — same SSE-friendly config as /api/stream.
      '/api/git/commit/stream': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyRes', (_proxyRes, _req, res) => {
            (res as any).flushHeaders?.();
          });
        },
      },
      '/api/git/push/stream': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyRes', (_proxyRes, _req, res) => {
            (res as any).flushHeaders?.();
          });
        },
      },
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
