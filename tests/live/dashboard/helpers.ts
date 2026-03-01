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

export async function expectAnyText(page: Page, candidates: string[]): Promise<void> {
  const body = (await page.locator('body').textContent()) ?? '';
  const matched = candidates.some((candidate) => body.toLowerCase().includes(candidate.toLowerCase()));
  expect(matched).toBeTruthy();
}
