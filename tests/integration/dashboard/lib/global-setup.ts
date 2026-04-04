import { chromium } from '@playwright/test';

import { DASHBOARD_BASE_URL } from './platform-env.js';

const DASHBOARD_READY_TIMEOUT_MS = 60_000;
const DASHBOARD_READY_POLL_INTERVAL_MS = 1_000;

export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const deadline = Date.now() + DASHBOARD_READY_TIMEOUT_MS;

  try {
    while (Date.now() < deadline) {
      try {
        await page.goto(`${DASHBOARD_BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
        if (await page.getByLabel('API Key').isVisible({ timeout: 2_000 }).catch(() => false)) {
          return;
        }
      } catch {
        // Keep polling until the login form is interactive.
      }

      await page.waitForTimeout(DASHBOARD_READY_POLL_INTERVAL_MS);
    }
  } finally {
    await browser.close();
  }

  throw new Error(`Timed out waiting for an interactive dashboard login page at ${DASHBOARD_BASE_URL}/login`);
}
