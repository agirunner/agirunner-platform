import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import { seedWorkflowsScenario } from './support/workflows-fixtures.js';

test('restores workflow scope, selected work item, and tab state across refresh and history', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.getByRole('button', { name: 'Prepare blocked release brief' }).click();
  await page.getByRole('button', { name: 'Steering' }).click();
  await expect(page).toHaveURL(/workflow=.*work_item=.*tab=steering/);
  await expect(page.getByText('Scoped to selected work item')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Steering request')).toBeVisible();
  await expect(page.getByText('Scoped to selected work item')).toBeVisible();

  await page.getByRole('button', { name: 'History' }).click();
  await expect(page).toHaveURL(/tab=history/);
  await page.goBack();
  await expect(page.getByText('Steering request')).toBeVisible();
  await page.goForward();
  await expect(page.getByText('Historical record')).toBeVisible();
});
