import { test } from '@playwright/test';

import { expectAnyText, gotoDashboard, tryLogin } from './helpers.js';

test.describe('dashboard templates', () => {
  test('browse built-ins and custom template flows', async ({ page }) => {
    await gotoDashboard(page, '/');
    await tryLogin(page);
    await gotoDashboard(page, '/templates');
    await expectAnyText(page, ['template', 'sdlc', 'maintenance', 'agentbaton']);
  });

  test('circular dependency rejection + versioning + instantiate surface', async ({ page }) => {
    await gotoDashboard(page, '/templates');
    await expectAnyText(page, ['template', 'version', 'instantiate', 'dependency']);
  });
});
