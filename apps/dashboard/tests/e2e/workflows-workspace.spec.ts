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
  await expect(page).toHaveURL(/workflows\/.+\?work_item_id=.*tab=steering/);
  await expect(
    page.getByText('Record durable requests, responses, and attachments for this work item.'),
  ).toBeVisible();
  await expect(page.getByText('Targeting work item: Prepare blocked release brief')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Steering request', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Record durable requests, responses, and attachments for this work item.'),
  ).toBeVisible();
  await expect(page.getByText('Targeting work item: Prepare blocked release brief')).toBeVisible();

  await page.getByRole('button', { name: 'Briefs' }).click();
  await expect(page).toHaveURL(/tab=history/);
});
