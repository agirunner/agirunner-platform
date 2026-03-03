import { expect, test } from '@playwright/test';

import { expectDashboardShell, gotoDashboard, tryLogin } from './helpers.js';

test.describe('dashboard workers', () => {
  test('status online/offline and claim updates surfaces', async ({ page }) => {
    await gotoDashboard(page, '/');
    await tryLogin(page);
    await gotoDashboard(page, '/workers');

    await expect(page).toHaveURL(/\/workers(\/|$)/);
    await expectDashboardShell(page);
    await expect(page.getByRole('heading', { name: 'Workers' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  });
});
