import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from '../lib/workflows-auth.js';
import { seedWorkflowsScenario } from '../lib/workflows-fixtures.js';

test.use({ viewport: { width: 1280, height: 1100 } });

test('keeps Details as the default workbench tab and scopes it to the selected work item', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();

  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await expect(workbench.getByRole('tab', { name: 'Details' })).toBeVisible();
  await expect(workbench.getByText(/^Workflow$/)).toBeVisible();
  await expect(workbench.getByText('What was asked')).toBeVisible();
  await expect(workbench.getByText('Input attachments', { exact: true })).toBeVisible();
  await expect(workbench.getByText('brief.md', { exact: true })).toBeVisible();
  await expect(workbench.getByText('Owner role')).toHaveCount(0);
  await expect(workbench.getByText('Next actor')).toHaveCount(0);
  await expect(workbench.getByText('Next expected action')).toHaveCount(0);
  await expect(workbench.getByText('Basics', { exact: true })).toHaveCount(0);
  await expect(workbench.getByText('Inputs', { exact: true })).toHaveCount(0);

  const workflowPacketDownload = page.waitForEvent('download');
  await workbench.getByRole('button', { name: 'brief.md' }).click();
  expect((await workflowPacketDownload).suggestedFilename()).toBe('brief.md');

  await page.getByRole('button', { name: 'Prepare blocked release brief' }).click();

  await expect(workbench.getByText('Work item · Prepare blocked release brief')).toBeVisible();
  await expect(workbench.getByText('What was asked')).toBeVisible();
  await expect(workbench.getByText('Current state')).toBeVisible();
  await expect(workbench.getByText('Waiting on rollback guidance.').first()).toBeVisible();
  await expect(workbench.getByText('Basics', { exact: true })).toHaveCount(0);
  await expect(workbench.getByText('Stage', { exact: true })).toHaveCount(0);
  await expect(workbench.getByText('Lane', { exact: true })).toHaveCount(0);
  await expect(workbench.getByText('Priority', { exact: true })).toHaveCount(0);
  await expect(workbench.getByText('Owner role')).toHaveCount(0);
  await expect(workbench.getByText('Task input')).toHaveCount(0);
  await expect(workbench.getByText('Artifact Id')).toHaveCount(0);

  const whatExistsRows = workbench.locator('[data-workflows-details-what-exists="rows"]');
  const heightMetrics = await whatExistsRows.evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  expect(heightMetrics.scrollHeight).toBeLessThanOrEqual(heightMetrics.clientHeight + 2);
});
