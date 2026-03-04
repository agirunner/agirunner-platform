import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './dashboard',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.LIVE_DASHBOARD_BASE_URL ?? 'http://127.0.0.1:3000',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [['list'], ['json', { outputFile: 'tests/artifacts/integration/dashboard-playwright.json' }]],
});
