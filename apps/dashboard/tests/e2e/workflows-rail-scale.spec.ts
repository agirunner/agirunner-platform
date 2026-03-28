import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import {
  createWorkflowViaApi,
  seedWorkflowsScenario,
} from './support/workflows-fixtures.js';

test('keeps the selected workflow stable while the rail grows and reorders', async ({ page }) => {
  const scenario = await seedWorkflowsScenario({ bulkWorkflowCount: 1005 });
  await loginToWorkflows(page);

  await page.getByRole('button', { name: 'Load more' }).click();
  await page.getByRole('button', { name: 'Load more' }).click();
  await workflowRailButton(page, 'E2E Bulk Workflow 0104').click();
  await expect(page.getByRole('heading', { name: 'E2E Bulk Workflow 0104' })).toBeVisible();

  await createWorkflowViaApi({
    name: 'E2E Bulk Workflow Reordered',
    playbookId: scenario.plannedPlaybook.id,
    workspaceId: scenario.workspace.id,
    parameters: {
      workflow_goal: 'Force a fresh workflow into the live rail ordering.',
    },
  });

  await expect(page.getByRole('heading', { name: 'E2E Bulk Workflow 0104' })).toBeVisible();
  await expect(workflowRailButton(page, 'E2E Bulk Workflow Reordered')).toBeVisible();
});
