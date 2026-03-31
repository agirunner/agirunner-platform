import { defineConfig } from '@playwright/test';

import { DASHBOARD_BASE_URL } from '../../tests/integration/dashboard/support/platform-env.js';

export default defineConfig({
  testDir: '../../tests/integration/dashboard',
  testMatch: ['**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: DASHBOARD_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [['list']],
});
