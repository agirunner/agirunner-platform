import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import { seedWorkflowsScenario } from './support/workflows-fixtures.js';
import { workflowsViewports } from './support/workflows-viewports.js';

for (const viewport of workflowsViewports) {
  test(`renders the workflows shell on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport.size);
    await seedWorkflowsScenario();
    await loginToWorkflows(page);

    await workflowRailButton(page, 'E2E Needs Action Delivery').click();
    await expect(page.getByRole('button', { name: /Hide workflows|Show workflows/ })).toBeVisible();
    await expect(page.getByText('Workflow board')).toBeVisible();
    await expect(page.locator('[data-workflows-workbench-frame="true"]')).toBeVisible();
  });
}

test('keeps the desktop workflows shell inside the viewport without a pointless root scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await expect(page.getByText('Workflow board')).toBeVisible();
  await expect(page.locator('[data-workflows-workbench-frame="true"]')).toBeVisible();

  const rootMetrics = await page.evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(rootMetrics.scrollHeight).toBeLessThanOrEqual(rootMetrics.clientHeight + 1);
  expect(rootMetrics.scrollWidth).toBeLessThanOrEqual(rootMetrics.clientWidth + 1);
});
