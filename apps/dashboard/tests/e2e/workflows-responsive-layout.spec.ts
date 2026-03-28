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
    await expect(page.getByText('Workflow Workbench')).toBeVisible();
  });
}
