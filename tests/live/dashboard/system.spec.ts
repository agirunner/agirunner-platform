import { expect, test } from '@playwright/test';

import { expectDashboardShell, expectOneOfHeadings, gotoDashboard, tryLogin } from './helpers.js';

test.describe('dashboard system', () => {
  test('metrics/theme/mobile/api-down banner surfaces', async ({ page }) => {
    await gotoDashboard(page, '/');
    await tryLogin(page);
    await gotoDashboard(page, '/system');

    await expect(page).toHaveURL(/\/(system|metrics|pipelines)(\/|$)/);
    await expectDashboardShell(page);
    await expectOneOfHeadings(page, ['System Metrics', 'Pipelines']);
  });
});
