import { expect, type Page } from '@playwright/test';

export function dashboardBaseUrl(): string {
  return process.env.LIVE_DASHBOARD_BASE_URL ?? 'http://127.0.0.1:3000';
}

export async function gotoDashboard(page: Page, path = '/'): Promise<void> {
  await page.goto(`${dashboardBaseUrl()}${path}`, { waitUntil: 'domcontentloaded' });
}

async function isVisible(locator: ReturnType<Page['locator']>): Promise<boolean> {
  if ((await locator.count()) === 0) {
    return false;
  }

  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

async function hasAuthenticatedDashboardShell(
  page: Page,
  pipelinesLink: ReturnType<Page['getByRole']>,
  apiKeyInput: ReturnType<Page['getByLabel']>,
): Promise<boolean> {
  if (page.url().includes('/login')) {
    return false;
  }

  if (await isVisible(apiKeyInput)) {
    return false;
  }

  return await isVisible(pipelinesLink);
}

async function verifyProtectedNavigation(
  page: Page,
  pipelinesLink: ReturnType<Page['getByRole']>,
  apiKeyInput: ReturnType<Page['getByLabel']>,
): Promise<boolean> {
  await gotoDashboard(page, '/pipelines');
  await page.waitForTimeout(500);
  return await hasAuthenticatedDashboardShell(page, pipelinesLink, apiKeyInput);
}

async function waitForLoginResult(
  page: Page,
  pipelinesLink: ReturnType<Page['getByRole']>,
  apiKeyInput: ReturnType<Page['getByLabel']>,
): Promise<'authenticated' | 'invalid-api-key' | 'timeout'> {
  const loginError = page.getByText('Invalid API key or server unavailable').first();
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if ((await loginError.count()) > 0 && (await loginError.isVisible())) {
      return 'invalid-api-key';
    }

    if (await hasAuthenticatedDashboardShell(page, pipelinesLink, apiKeyInput)) {
      return 'authenticated';
    }

    await page.waitForTimeout(250);
  }

  return 'timeout';
}

export async function tryLogin(page: Page): Promise<void> {
  const apiKey =
    process.env.LIVE_DASHBOARD_API_KEY ??
    process.env.DEFAULT_ADMIN_API_KEY ??
    process.env.LIVE_DASHBOARD_PASSWORD ??
    '';

  const pipelinesLink = page.getByRole('link', { name: 'Pipelines' }).first();
  const apiKeyInput = page.getByLabel('API Key').first();

  if (await verifyProtectedNavigation(page, pipelinesLink, apiKeyInput)) {
    return;
  }

  if (!apiKey) {
    throw new Error('Missing dashboard API key (set LIVE_DASHBOARD_API_KEY or DEFAULT_ADMIN_API_KEY)');
  }

  const submit = page
    .locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")')
    .first();

  let lastOutcome: 'authenticated' | 'invalid-api-key' | 'timeout' = 'timeout';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await gotoDashboard(page, '/login');
    await apiKeyInput.waitFor({ state: 'visible', timeout: 10_000 });
    await apiKeyInput.fill(apiKey);
    await submit.waitFor({ state: 'visible', timeout: 10_000 });
    await submit.click();

    lastOutcome = await waitForLoginResult(page, pipelinesLink, apiKeyInput);
    if (lastOutcome === 'authenticated') {
      if (await verifyProtectedNavigation(page, pipelinesLink, apiKeyInput)) {
        return;
      }

      lastOutcome = 'timeout';
    }

    if (attempt < 3) {
      await page.waitForTimeout(500);
    }
  }

  throw new Error(`Dashboard login did not establish a stable session (outcome: ${lastOutcome})`);
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
