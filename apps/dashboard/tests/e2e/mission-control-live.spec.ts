import { expect, test } from '@playwright/test';

import { loginToDashboard } from './support/mission-control-auth.js';
import { seedMissionControlScenario } from './support/mission-control-fixtures.js';

test('shows populated live, recent, and history mission control modes', async ({ page }) => {
  await seedMissionControlScenario();
  await loginToDashboard(page);

  await expect(page.getByRole('tab', { name: 'Live' })).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('heading', { name: 'At Risk' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Progressing' })).toBeVisible();
  await expect(page.getByText('E2E Blocked Delivery')).toBeVisible();
  await expect(page.getByText('E2E Recovery Candidate')).toBeVisible();
  await expect(page.getByText('E2E In Flight Delivery')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs Intervention' })).toBeVisible();
  await expect(page.getByText('Operator attention required').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Recent' }).click();
  await expect(page.getByText('Shift handoff')).toBeVisible();
  await expect(page.getByText('Workflow Created').first()).toBeVisible();

  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('Historical record')).toBeVisible();
  await expect(page.getByText('Workflow Output Published')).toBeVisible();
});
