import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import {
  listWorkflows,
  seedWorkflowsScenario,
} from './support/workflows-fixtures.js';

test('launches a linked redrive attempt from the workflows workbench', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Redrive Candidate').click();
  await page.getByRole('button', { name: 'Steering' }).click();
  await page.getByRole('button', { name: 'Redrive Workflow' }).click();

  await page.getByLabel('New attempt name').fill('E2E Redrive Candidate Attempt 2');
  await page.getByLabel('Redrive summary').fill('Retry with corrected release inputs.');
  await page.getByLabel('Steering instruction').fill('Use the corrected validation path and relaunch the run.');
  await page.getByRole('button', { name: 'Add parameter override' }).click();
  await page.getByPlaceholder('Parameter key').fill('workflow_goal');
  await page.getByPlaceholder('Override value').fill('Recover the failed validation workflow');
  await page.getByRole('button', { name: 'Redrive' }).click();

  await expect(page.getByText('Workflow redrive launched')).toBeVisible();
  await expect
    .poll(async () => {
      const workflows = await listWorkflows();
      return workflows.some((workflow) => workflow.name === 'E2E Redrive Candidate Attempt 2');
    })
    .toBe(true);
});
