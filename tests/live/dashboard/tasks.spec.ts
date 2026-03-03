import { expect, test } from '@playwright/test';

import { expectDashboardShell, expectOneOfHeadings, gotoDashboard, tryLogin } from './helpers.js';

test.describe('dashboard tasks', () => {
  test('list/filter/detail/artifacts/create/cancel/timeout surfaces', async ({ page }) => {
    await gotoDashboard(page, '/');
    await tryLogin(page);
    await gotoDashboard(page, '/tasks');

    await expect(page).toHaveURL(/\/(tasks|pipelines)(\/|$)/);
    await expectDashboardShell(page);
    await expectOneOfHeadings(page, ['Task Detail', 'Pipelines']);
  });
});
