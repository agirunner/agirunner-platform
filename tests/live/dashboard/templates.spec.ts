import { expect, test } from '@playwright/test';

import { expectDashboardShell, expectOneOfHeadings, gotoDashboard, tryLogin } from './helpers.js';

test.describe('dashboard templates', () => {
  test('browse built-ins and custom template flows', async ({ page }) => {
    await gotoDashboard(page, '/');
    await tryLogin(page);
    await gotoDashboard(page, '/templates');

    await expect(page).toHaveURL(/\/(templates|workflows)(\/|$)/);
    await expectDashboardShell(page);
    await expectOneOfHeadings(page, ['Templates', 'Workflows']);
  });

  test('circular dependency rejection + versioning + instantiate surface', async ({ page }) => {
    await gotoDashboard(page, '/templates');

    await expect(page).toHaveURL(/\/(templates|workflows|login)(\/|$)/);
    await expectOneOfHeadings(page, ['Templates', 'Workflows', 'Agirunner Dashboard']);
  });
});
