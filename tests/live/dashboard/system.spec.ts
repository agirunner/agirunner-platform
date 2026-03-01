import { test } from '@playwright/test';

import { expectAnyText, gotoDashboard, tryLogin } from './helpers.js';

test.describe('dashboard system', () => {
  test('metrics/theme/mobile/api-down banner surfaces', async ({ page }) => {
    await gotoDashboard(page, '/');
    await tryLogin(page);
    await gotoDashboard(page, '/system');
    await expectAnyText(page, ['metric', 'theme', 'mobile', 'api', 'banner']);
  });
});
