import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import {
  listWorkflowInputPackets,
  seedWorkflowsScenario,
} from './support/workflows-fixtures.js';

test.use({ viewport: { width: 1280, height: 1100 } });

test('records work-item steering from the local card control instead of a steering tab', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.getByRole('button', { name: 'Prepare blocked release brief' }).click();
  await page.locator('[data-work-item-local-control="steer"]').click();

  await expect(page.getByRole('heading', { name: 'Steer work item' })).toBeVisible();
  await expect(page.getByText('Targeting work item: Prepare blocked release brief')).toBeVisible();
  await page.getByPlaceholder(/Guide Prepare blocked release brief toward the next legal action/i).fill(
    'Prioritize the release-risk summary before any new implementation work.',
  );
  const steeringSubmitButton = page.getByRole('button', { name: 'Record steering request' });
  await steeringSubmitButton.evaluate((node) => {
    node.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
  await steeringSubmitButton.click();

  await expect(page.getByText('Steering request recorded')).toBeVisible();
  await expect(page.getByText('Prioritize the release-risk summary before any new implementation work.')).toBeVisible();

  await expect
    .poll(async () => {
      const packets = await listWorkflowInputPackets(scenario.needsActionWorkflow.id);
      return packets.length >= 1;
    })
    .toBe(true);
});

test('routes needs-action through local work-item controls while keeping workflow pause and resume global', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Ongoing Intake').click();
  await page
    .locator('[data-workflows-top-strip="true"]')
    .getByRole('button', { name: 'Pause' })
    .click();
  await expect(page.getByText('Workflow paused', { exact: true }).first()).toBeVisible();
  await page
    .locator('[data-workflows-top-strip="true"]')
    .getByRole('button', { name: 'Resume' })
    .click();
  await expect(page.getByText('Workflow resumed', { exact: true }).first()).toBeVisible();

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.locator('[data-work-item-local-control="needs-action"]').click();
  await expect(page.getByText('Work item · Prepare blocked release brief').first()).toBeVisible();
  await expect(page.getByText('Waiting on rollback guidance')).toBeVisible();
});
