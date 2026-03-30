import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import { seedWorkflowsScenario } from './support/workflows-fixtures.js';

test('restores workflow scope, selected work item, and tab state across refresh and live console', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.getByRole('button', { name: 'Prepare blocked release brief' }).click();
  await expect(page).toHaveURL(/workflows\/.+\?work_item_id=.*tab=details/);
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await expect(workbench.getByText('Work item · Prepare blocked release brief')).toBeVisible();
  await expect(workbench.getByText('What was asked')).toBeVisible();

  await page.reload();
  await expect(workbench.getByText('Work item · Prepare blocked release brief')).toBeVisible();
  await expect(workbench.getByText('What was asked')).toBeVisible();

  await page.getByRole('button', { name: 'Live Console' }).click();
  await expect(page).toHaveURL(/tab=live_console/);
});

test('opens a steer composer with inputs directly from the work-item card action', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();

  const workItemCard = page
    .locator('[data-work-item-card="true"]')
    .filter({ hasText: 'Prepare blocked release brief' })
    .first();

  await expect(workItemCard).toBeVisible();
  await workItemCard.getByRole('button', { name: 'Steer work item' }).click();

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Steer work item' })).toBeVisible();
  await expect(page.getByLabel('Operator guidance')).toBeVisible();
  await expect(page.getByLabel('Operator guidance')).toHaveAttribute(
    'placeholder',
    /Guide Prepare blocked release brief toward the next legal action\./,
  );
});
