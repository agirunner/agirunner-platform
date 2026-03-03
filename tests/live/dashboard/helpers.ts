import { expect, type Page } from '@playwright/test';

export function dashboardBaseUrl(): string {
  return process.env.LIVE_DASHBOARD_BASE_URL ?? 'http://127.0.0.1:3000';
}

export async function gotoDashboard(page: Page, path = '/'): Promise<void> {
  await page.goto(`${dashboardBaseUrl()}${path}`, { waitUntil: 'domcontentloaded' });
}

export async function tryLogin(page: Page): Promise<void> {
  const username = process.env.LIVE_DASHBOARD_USERNAME ?? 'admin@agentbaton.local';
  const password = process.env.LIVE_DASHBOARD_PASSWORD ?? 'agentbaton';

  const emailInput = page.locator('input[type="email"], input[name="email"]');
  if ((await emailInput.count()) > 0) {
    await emailInput.first().fill(username);
  }

  const passwordInput = page.locator('input[type="password"], input[name="password"]');
  if ((await passwordInput.count()) > 0) {
    await passwordInput.first().fill(password);
  }

  const submit = page
    .locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")')
    .first();
  if ((await submit.count()) > 0) {
    await submit.click();
  }
}

export async function expectLoginPage(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'AgentBaton Dashboard' })).toBeVisible();
  await expect(page.getByLabel('API Key')).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
}

export async function expectDashboardShell(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: 'Pipelines' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Workers' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'System Metrics' })).toBeVisible();
}

export async function expectOneOfHeadings(page: Page, names: Array<string | RegExp>): Promise<void> {
  await expect
    .poll(
      async () => {
        for (const name of names) {
          const heading = page.getByRole('heading', { name }).first();
          if ((await heading.count()) === 0) {
            continue;
          }

          if (await heading.isVisible()) {
            return true;
          }
        }

        return false;
      },
      { message: `Expected one of headings to be visible: ${names.map(String).join(', ')}` },
    )
    .toBe(true);
}
