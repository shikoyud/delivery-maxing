import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@dm/tools',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
