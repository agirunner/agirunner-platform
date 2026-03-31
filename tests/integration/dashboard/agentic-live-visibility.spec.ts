import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import {
  createWorkflowViaApi,
  seedWorkflowsScenario,
} from './support/workflows-fixtures.js';

test('keeps workflow live visibility on tenant defaults and removes workflow-page override controls', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  await loginToWorkflows(page);

  const workflow = await createWorkflowViaApi({
    name: 'E2E Tenant Default Visibility',
    playbookId: scenario.plannedPlaybook.id,
    workspaceId: scenario.workspace.id,
    parameters: {
      workflow_goal: 'Confirm workflow pages keep live visibility on tenant defaults.',
    },
  });

  await page.goto(`/workflows?workflow=${workflow.id}`);
  await expect(workflowRailButton(page, 'E2E Tenant Default Visibility')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Live visibility' })).toHaveCount(0);
  await expect(
    page.locator('[data-workflows-top-strip="true"]').getByText('Live visibility', { exact: false }),
  ).toHaveCount(0);
});
