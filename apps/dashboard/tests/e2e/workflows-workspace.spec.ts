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
  await expect(page).toHaveURL(/workflows\/.+\?work_item_id=.*tab=details/);
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await expect(workbench.getByText('Work item · Prepare blocked release brief')).toBeVisible();
  await expect(workbench.getByText('What was asked')).toBeVisible();

  await page.reload();
  await expect(workbench.getByText('Work item · Prepare blocked release brief')).toBeVisible();
  await expect(workbench.getByText('What was asked')).toBeVisible();

  await page.getByRole('button', { name: 'History' }).click();
  await expect(page).toHaveURL(/tab=history/);
});
