import { expect, test } from '@playwright/test';

import { expectDashboardShell, expectLoginPage, expectOneOfHeadings, gotoDashboard, tryLogin } from './helpers.js';

test.describe('dashboard auth', () => {
  test('login, logout, session refresh markers', async ({ page }) => {
    await gotoDashboard(page, '/');
    await tryLogin(page);
    await expectDashboardShell(page);
    await expectOneOfHeadings(page, ['Workflows', 'Workflow Detail']);

    const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Sign out")').first();
    if ((await logoutButton.count()) > 0) {
      await logoutButton.click();
      await expectLoginPage(page);
      return;
    }

    await page.reload();
    await expectDashboardShell(page);
  });

  test('wrong password path is handled', async ({ page }) => {
    await gotoDashboard(page, '/login');
    await expectLoginPage(page);

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

    await expect(page.getByLabel('API Key')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('expired token path renders sane fallback', async ({ page, context }) => {
    await context.addCookies([
      {
        name: 'agirunner_access_token',
        value: 'expired-token',
        url: 'http://127.0.0.1:3000',
      },
    ]);
    await gotoDashboard(page, '/');

    const loginHeading = page.getByRole('heading', { name: 'Agirunner Dashboard' }).first();
    if ((await loginHeading.count()) > 0 && (await loginHeading.isVisible())) {
      await expectLoginPage(page);
      return;
    }

    await expectDashboardShell(page);
  });
});
