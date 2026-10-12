import { defineConfig, devices } from '@playwright/test';

const base = process.env.PAGES_BASE ?? '/';
const url = `http://localhost:4173${base}`;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: url,
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM_PATH,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'pnpm preview --port 4173 --strictPort',
    url,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
