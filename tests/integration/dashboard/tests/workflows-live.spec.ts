import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  loginToWorkflowsWithPrefill,
  workflowsPrimaryNavLink,
  workflowRailButton,
} from '../lib/workflows-auth.js';
import { seedWorkflowsScenario } from '../lib/workflows-fixtures.js';

test('redirects into Workflows and defaults the workbench by workflow posture', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await expect(page).toHaveURL(/\/workflows/);
  await expect(workflowsPrimaryNavLink(page)).toBeVisible();
  await expect(page.getByText('Open full workflow')).toHaveCount(0);
  await expect(page.locator('aside button').filter({ hasText: 'E2E Ongoing Intake' })).toHaveCount(1);

  await workflowRailButton(page, 'E2E Ongoing Intake').click();
  await expect(page.locator('h2').filter({ hasText: 'E2E Ongoing Intake' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Live Console' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Details' })).toBeVisible();

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await expect(page.getByRole('tab', { name: /^Details$/ }).first()).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: /^Needs Action/ }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Deliverables' }).click();
  await expect(
    page.getByText('Showing all deliverables recorded across this workflow'),
  ).toBeVisible();
  await expect(page.getByRole('table').first().getByText(/^Final$/).first()).toBeVisible();

});

test('preloads the seeded admin key on the login screen and signs in without manual entry', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflowsWithPrefill(page);

  await expect(workflowsPrimaryNavLink(page)).toBeVisible();
  await expect(page).toHaveURL(/\/workflows/);
});
