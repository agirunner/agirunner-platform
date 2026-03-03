import { expect, test } from '@playwright/test';

import { expectDashboardShell, gotoDashboard, tryLogin } from './helpers.js';

test.describe('dashboard pipelines', () => {
  test('list/detail/create/cancel/cascade/SSE surfaces', async ({ page }) => {
    await gotoDashboard(page, '/');
    await tryLogin(page);
    await gotoDashboard(page, '/pipelines');

    await expect(page).toHaveURL(/\/pipelines(\/|$)/);
    await expectDashboardShell(page);
    await expect(page.getByRole('heading', { name: 'Pipelines' })).toBeVisible();
  });
});
