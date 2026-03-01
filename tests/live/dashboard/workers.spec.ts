import { test } from '@playwright/test';

import { expectAnyText, gotoDashboard, tryLogin } from './helpers.js';

test.describe('dashboard workers', () => {
  test('status online/offline and claim updates surfaces', async ({ page }) => {
    await gotoDashboard(page, '/');
    await tryLogin(page);
    await gotoDashboard(page, '/workers');
    await expectAnyText(page, ['worker', 'online', 'offline', 'claim']);
  });
});
