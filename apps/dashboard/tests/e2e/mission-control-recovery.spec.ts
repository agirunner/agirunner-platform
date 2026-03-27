import { expect, test } from '@playwright/test';

import { loginToDashboard } from './support/mission-control-auth.js';
import { listWorkflows, seedMissionControlScenario } from './support/mission-control-fixtures.js';

test('redrives a failed workflow into a new linked attempt', async ({ page }) => {
  await seedMissionControlScenario();
  await loginToDashboard(page);

  await page.getByRole('link', { name: 'Open E2E Recovery Candidate workflow' }).click();

  await page.getByRole('tab', { name: 'Steering' }).click();
  await expect(page.getByRole('button', { name: 'Redrive workflow' })).toBeEnabled();
  await page.getByRole('button', { name: 'Redrive workflow' }).click();

  await page.getByLabel('New attempt name').fill('E2E Recovery Candidate Attempt 2');
  await page.getByLabel('Redrive summary').fill('Retry with corrected release inputs.');
  await page.getByLabel('Steering instruction').fill('Use the corrected validation path and relaunch the run.');
  await page.getByRole('button', { name: 'Add parameter override' }).click();
  await page.getByPlaceholder('Parameter key').fill('workflow_goal');
  await page.getByPlaceholder('Override value').fill('Recover the failed validation workflow');
  await page.getByRole('button', { name: 'Redrive workflow' }).last().click();

  await expect(page.getByText('Workflow redrive launched')).toBeVisible();
  await expect
    .poll(async () => {
      const workflows = await listWorkflows();
      return workflows.some((workflow) => workflow.name === 'E2E Recovery Candidate Attempt 2');
    })
    .toBe(true);

  await page.goto('/mission-control');
  await expect(page.getByText('E2E Recovery Candidate Attempt 2')).toBeVisible();
});
