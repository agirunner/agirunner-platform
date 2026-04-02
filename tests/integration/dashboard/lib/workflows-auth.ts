import { expect, type Locator, type Page } from '@playwright/test';

import { ADMIN_API_KEY } from './platform-env.js';

export async function loginToWorkflows(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('API Key').fill(ADMIN_API_KEY);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/workflows/);
  await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
}

export async function loginToWorkflowsWithPrefill(page: Page): Promise<void> {
  await page.goto('/login');
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
