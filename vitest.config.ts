/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

const isWindows = process.platform === 'win32';

export default defineConfig({
  plugins: [tsconfigPaths({ ignoreConfigErrors: true })],
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
    setupFiles: ['tests/setup.ts', 'vitest.setup.ts'],
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'app/**/__tests__/**/*.test.ts',
      'lib/**/__tests__/**/*.test.ts',
    ],
    exclude: [
      'tests/e2e/**',
      'tests/db/**',
      'tests/routes/**',
      'tests/pages/**',
    ],
    environmentMatchGlobs: [
      ['tests/components/**', 'jsdom'],
    ],
    environmentOptions: { jsdom: { url: 'http://localhost' } },
    coverage: { provider: 'v8' },
    onConsoleLog: (log) => /TT: undefined function: 21/.test(log) ? false : undefined,
    // Windows: forks pool is more reliable (threads can exit 1 despite passing)
    pool: isWindows ? 'forks' : 'threads',
    poolOptions: isWindows
      ? {
          forks: {
            singleFork: true,
            maxForks: 1,
            minForks: 1,
          },
        }
      : {
          threads: {
            maxThreads: 2,
            minThreads: 1,
          },
        },
  },
});
