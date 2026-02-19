import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  worker: {
    format: 'es',
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api/stream': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        // SSE streams are long-lived — disable proxy timeout and buffering
        // so the connection stays open for the full duration of the response.
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          // Disable response buffering so SSE events flow through immediately
          proxy.on('proxyRes', (_proxyRes, _req, res) => {
            // Flush headers immediately for streaming
            (res as any).flushHeaders?.();
          });
        },
      },
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
});
