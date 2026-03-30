import { expect, test, type Page } from '@playwright/test';

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

  await revealWorkflowInRail(page, 'E2E Bulk Workflow 0104');
  await workflowRailButton(page, 'E2E Bulk Workflow 0104').click();
  await expect(workflowWorkspaceHeading(page, 'E2E Bulk Workflow 0104')).toBeVisible();

  await createWorkflowViaApi({
    name: 'E2E Bulk Workflow Reordered',
    playbookId: scenario.plannedPlaybook.id,
    workspaceId: scenario.workspace.id,
    parameters: {
      workflow_goal: 'Force a fresh workflow into the live rail ordering.',
    },
  });

  await expect(workflowWorkspaceHeading(page, 'E2E Bulk Workflow 0104')).toBeVisible();
  await expect(workflowRailButton(page, 'E2E Bulk Workflow Reordered')).toBeVisible();
});

async function revealWorkflowInRail(page: Page, workflowName: string): Promise<void> {
  const scrollRegion = page.locator('[data-workflows-rail-scroll-region="true"]');

  await expect
    .poll(async () => {
      await scrollRegion.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      return workflowRailButton(page, workflowName).count();
    }, {
      message: `Expected ${workflowName} to become visible after rail pagination.`,
    })
    .toBeGreaterThan(0);
}

function workflowWorkspaceHeading(page: Page, workflowName: string) {
  return page.locator('h2').filter({ hasText: workflowName }).first();
}
