import { expect, type Locator, type Page } from '@playwright/test';

import { ADMIN_API_KEY } from './platform-env.js';

const LOGIN_FORM_READY_TIMEOUT_MS = 10_000;
const LOGIN_NAVIGATION_ATTEMPTS = 2;

async function waitForLoginForm(page: Page): Promise<void> {
  const apiKeyField = page.getByLabel('API Key');

  for (let attempt = 1; attempt <= LOGIN_NAVIGATION_ATTEMPTS; attempt += 1) {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    try {
      await expect(apiKeyField).toBeVisible({ timeout: LOGIN_FORM_READY_TIMEOUT_MS });
      return;
    } catch (error) {
      if (attempt === LOGIN_NAVIGATION_ATTEMPTS) {
        throw error;
      }
    }
  }
}

export async function loginToWorkflows(page: Page): Promise<void> {
  await waitForLoginForm(page);
  await page.getByLabel('API Key').fill(ADMIN_API_KEY);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/workflows/);
  await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
}

export async function loginToWorkflowsWithPrefill(page: Page): Promise<void> {
  await waitForLoginForm(page);
  await expect(page.getByLabel('API Key')).toHaveValue(ADMIN_API_KEY);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/workflows/);
}

export function workflowsPrimaryNavLink(page: Page): Locator {
  return page.getByLabel('Desktop navigation').getByRole('link', { name: 'Workflows' });
}

export function workflowRailButton(page: Page, name: string): Locator {
  return page.locator('aside button').filter({ hasText: name }).first();
}
