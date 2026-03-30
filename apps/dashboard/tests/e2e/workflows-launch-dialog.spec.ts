import { expect, test, type Locator, type Page } from '@playwright/test';

import { loginToWorkflows } from './support/workflows-auth.js';
import { seedLaunchDialogScenario } from './support/workflows-fixtures.js';

test('keeps launch selector options populated on every open', async ({ page }) => {
  await seedLaunchDialogScenario();
  await loginToWorkflows(page);

  await page.locator('aside').getByRole('button', { name: 'New Workflow' }).click();
  await expect(page.getByRole('heading', { name: 'New workflow' })).toBeVisible();

  const playbookTrigger = page.locator('label').filter({ hasText: 'Playbook' }).getByRole('button');
  const workspaceTrigger = page.locator('label').filter({ hasText: 'Workspace' }).getByRole('button');

  await expectLaunchSelectorOptions(page, playbookTrigger);
  await expectLaunchSelectorOptions(page, playbookTrigger);
  await expectLaunchSelectorOptions(page, playbookTrigger);
  await expectLaunchSelectorOptions(page, playbookTrigger);

  await expectLaunchSelectorOptions(page, workspaceTrigger);
  await expectLaunchSelectorOptions(page, workspaceTrigger);
  await expectLaunchSelectorOptions(page, workspaceTrigger);
  await expectLaunchSelectorOptions(page, workspaceTrigger);
});

async function expectLaunchSelectorOptions(page: Page, trigger: Locator): Promise<void> {
  await trigger.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await expect(page.getByText('No results found')).toHaveCount(0);
  await expect
    .poll(async () => page.getByRole('option').count(), {
      message: 'Expected launch selector to show at least one option.',
    })
    .toBeGreaterThan(0);
  await trigger.click();
  await expect(listbox).toBeHidden();
}
