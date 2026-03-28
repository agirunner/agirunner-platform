import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import {
  createWorkflowViaApi,
  seedWorkflowsScenario,
} from './support/workflows-fixtures.js';

test('applies tenant live visibility defaults to new workflows and allows workflow overrides', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await page.goto('/runtimes');
  await page.getByLabel('Workflow live visibility').selectOption('standard');
  await page.getByRole('button', { name: 'Save live visibility' }).click();
  await expect(page.getByText('Live visibility settings saved.')).toBeVisible();

  const workflow = await createWorkflowViaApi({
    name: 'E2E Tenant Default Visibility',
    playbookId: scenario.plannedPlaybook.id,
    workspaceId: scenario.workspace.id,
    parameters: {
      workflow_goal: 'Confirm new workflows inherit tenant live visibility defaults.',
    },
  });

  await page.goto(`/workflows?workflow=${workflow.id}`);
  await expect(workflowRailButton(page, 'E2E Tenant Default Visibility')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Inherit tenant default (standard)' })).toBeVisible();

  await page.getByLabel('Live visibility').selectOption('enhanced');
  await expect(page.getByLabel('Live visibility')).toHaveValue('enhanced');
});
