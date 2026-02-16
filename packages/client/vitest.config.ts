import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    alias: {
      $lib: new URL('./src/lib', import.meta.url).pathname,
      '@e/shared': new URL('../shared/src', import.meta.url).pathname,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'happy-dom',
    globals: true,
    coverage: {
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts', 'src/lib/**/*.svelte.ts'],
    },
  },
});
