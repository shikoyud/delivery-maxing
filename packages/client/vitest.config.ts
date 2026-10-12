import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@dm/client',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
