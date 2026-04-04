/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

const isWindows = process.platform === 'win32';

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./', import.meta.url)) },
      { find: '@/', replacement: fileURLToPath(new URL('./', import.meta.url)) },
      { find: '@/lib', replacement: fileURLToPath(new URL('./lib', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['vitest.setup.ts'],
    include: ['tests/eval/llm-judge.test.ts'],
    environmentOptions: { jsdom: { url: 'http://localhost' } },
    coverage: { provider: 'v8' },
    pool: isWindows ? 'forks' : 'threads',
  },
});
