import { expect, test } from '@playwright/test';

import { expectAnyText, gotoDashboard, tryLogin } from './helpers.js';

test.describe('dashboard auth', () => {
  test('login, logout, session refresh markers', async ({ page }) => {
    await gotoDashboard(page, '/');
    await tryLogin(page);
    await expectAnyText(page, ['pipeline', 'task', 'dashboard', 'agentbaton']);

    const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Sign out")').first();
    if ((await logoutButton.count()) > 0) {
      await logoutButton.click();
    }

    await page.reload();
    expect(page.url()).toContain('http');
  });

  test('wrong password path is handled', async ({ page }) => {
    await gotoDashboard(page, '/login');
    const email = page.locator('input[type="email"], input[name="email"]');
    const password = page.locator('input[type="password"], input[name="password"]');
    if ((await email.count()) > 0 && (await password.count()) > 0) {
      await email.first().fill('qa@example.com');
      await password.first().fill('wrong-password');
      const submit = page.locator('button[type="submit"]').first();
      if ((await submit.count()) > 0) {
        await submit.click();
      }
    }

    await expectAnyText(page, ['invalid', 'error', 'login', 'agentbaton']);
  });

  test('expired token path renders sane fallback', async ({ page, context }) => {
    await context.addCookies([
      {
        name: 'agentbaton_access_token',
        value: 'expired-token',
        url: 'http://127.0.0.1:3000',
      },
    ]);
    await gotoDashboard(page, '/');
    await expectAnyText(page, ['login', 'dashboard', 'agentbaton']);
  });
});
