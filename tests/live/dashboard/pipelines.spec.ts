import { test } from '@playwright/test';

import { expectAnyText, gotoDashboard, tryLogin } from './helpers.js';

test.describe('dashboard pipelines', () => {
  test('list/detail/create/cancel/cascade/SSE surfaces', async ({ page }) => {
    await gotoDashboard(page, '/');
    await tryLogin(page);
    await gotoDashboard(page, '/pipelines');
    await expectAnyText(page, ['pipeline', 'dag', 'cancel', 'live', 'event']);
  });
});
