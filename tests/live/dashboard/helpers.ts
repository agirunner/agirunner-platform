import { expect, type Page } from '@playwright/test';

export function dashboardBaseUrl(): string {
  return process.env.LIVE_DASHBOARD_BASE_URL ?? 'http://127.0.0.1:3000';
}

export async function gotoDashboard(page: Page, path = '/'): Promise<void> {
  await page.goto(`${dashboardBaseUrl()}${path}`, { waitUntil: 'domcontentloaded' });
}

export async function tryLogin(page: Page): Promise<void> {
  const apiKey =
    process.env.LIVE_DASHBOARD_API_KEY ??
    process.env.DEFAULT_ADMIN_API_KEY ??
    process.env.LIVE_DASHBOARD_PASSWORD ??
    '';

  const pipelinesLink = page.getByRole('link', { name: 'Pipelines' }).first();
  if ((await pipelinesLink.count()) > 0 && (await pipelinesLink.isVisible())) {
    return;
  }

  const apiKeyInput = page.getByLabel('API Key').first();
  await apiKeyInput.waitFor({ state: 'visible', timeout: 10_000 });

  if (!apiKey) {
    throw new Error('Missing dashboard API key (set LIVE_DASHBOARD_API_KEY or DEFAULT_ADMIN_API_KEY)');
  }

  await apiKeyInput.fill(apiKey);

  const submit = page
    .locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")')
    .first();
  await submit.waitFor({ state: 'visible', timeout: 10_000 });
  await submit.click();

  const loginError = page.getByText('Invalid API key or server unavailable').first();
  await expect
    .poll(
      async () => {
        if ((await pipelinesLink.count()) > 0 && (await pipelinesLink.isVisible())) {
          return 'authenticated';
        }
        if ((await loginError.count()) > 0 && (await loginError.isVisible())) {
          return 'invalid-api-key';
        }
        return 'pending';
      },
      { timeout: 20_000 },
    )
    .toBe('authenticated');
}

export async function expectLoginPage(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'AgentBaton Dashboard' })).toBeVisible();
  await expect(page.getByLabel('API Key')).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
}

export async function expectDashboardShell(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: 'Pipelines' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'Workers' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'System Metrics' })).toBeVisible({ timeout: 15_000 });
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
