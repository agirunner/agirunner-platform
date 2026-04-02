import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

import { DASHBOARD_BASE_URL } from '../../tests/integration/dashboard/lib/platform-env.js';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(CURRENT_DIR, '../..');
const shouldStartWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === '0';

export default defineConfig({
  testDir: '../../tests/integration/dashboard/tests',
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
  webServer: shouldStartWebServer
    ? {
        command: 'corepack pnpm exec tsx tests/integration/dashboard/lib/community-catalog-stack.ts',
        cwd: REPO_ROOT,
        url: `${DASHBOARD_BASE_URL}/login`,
        reuseExistingServer: false,
        timeout: 240_000,
      }
    : undefined,
});
