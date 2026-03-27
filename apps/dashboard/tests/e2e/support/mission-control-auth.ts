import { expect, type Page } from '@playwright/test';

import { ADMIN_API_KEY } from './platform-env.js';

export async function loginToDashboard(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('API Key').fill(ADMIN_API_KEY);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/mission-control/);
  await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible();
}
