import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  loginToWorkflowsWithPrefill,
  workflowsPrimaryNavLink,
  workflowRailButton,
} from './support/workflows-auth.js';
import { seedWorkflowsScenario } from './support/workflows-fixtures.js';

test('redirects into Workflows and defaults the workbench by workflow posture', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await expect(page).toHaveURL(/\/workflows/);
  await expect(workflowsPrimaryNavLink(page)).toBeVisible();
  await expect(page.getByText('Open full workflow')).toHaveCount(0);
  await expect(page.locator('aside button').filter({ hasText: 'E2E Ongoing Intake' })).toHaveCount(1);

  await workflowRailButton(page, 'E2E Ongoing Intake').click();
  await expect(page.getByRole('heading', { name: 'E2E Ongoing Intake' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Live Console' })).toBeVisible();
  await expect(page.getByText('Initial execution burst')).toBeVisible();

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await expect(page.getByText('Needs Action')).toBeVisible();
  await expect(page.getByText('Operator attention required')).toBeVisible();

  await page.getByRole('button', { name: 'Deliverables' }).click();
  await expect(page.getByText('Inputs & Provenance')).toBeVisible();

  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText('Historical record')).toBeVisible();
});

test('preloads the seeded admin key on the login screen and signs in without manual entry', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflowsWithPrefill(page);

  await expect(workflowsPrimaryNavLink(page)).toBeVisible();
  await expect(page).toHaveURL(/\/workflows/);
});
