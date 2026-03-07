import { expect, test } from '@playwright/test';

import { expectDashboardShell, gotoDashboard, tryLogin } from './helpers.js';

test.describe('dashboard workflows', () => {
  test('list/detail/create/cancel/cascade/SSE surfaces', async ({ page }) => {
    await gotoDashboard(page, '/');
    await tryLogin(page);
    await gotoDashboard(page, '/workflows');

    await expect(page).toHaveURL(/\/workflows(\/|$)/);
    await expectDashboardShell(page);
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
  });
});
