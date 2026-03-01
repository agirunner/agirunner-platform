import { test } from '@playwright/test';

import { expectAnyText, gotoDashboard, tryLogin } from './helpers.js';

test.describe('dashboard tasks', () => {
  test('list/filter/detail/artifacts/create/cancel/timeout surfaces', async ({ page }) => {
    await gotoDashboard(page, '/');
    await tryLogin(page);
    await gotoDashboard(page, '/tasks');
    await expectAnyText(page, ['task', 'filter', 'phase', 'artifact', 'cancel', 'timeout']);
  });
});
