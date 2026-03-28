import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import {
  listWorkflowInputPackets,
  seedWorkflowsScenario,
} from './support/workflows-fixtures.js';

test('supports pause, resume, add work, and steering requests from the workflows workbench', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Ongoing Intake').click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Workflow paused')).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('Workflow resumed')).toBeVisible();

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.getByRole('button', { name: 'Steering' }).click();

  await page.getByRole('button', { name: 'Add / Modify Work' }).click();
  await page.getByLabel('Title').fill('Regression follow-up');
  await page.getByLabel('Goal').fill('Verify the follow-up path is captured.');
  await page.getByRole('button', { name: 'Add / Modify Work' }).last().click();
  await expect(page.getByText('Workflow plan updated')).toBeVisible();

  await expect
    .poll(async () => {
      const packets = await listWorkflowInputPackets(scenario.needsActionWorkflow.id);
      return packets.some((packet) => String(packet.summary ?? '').includes('Regression follow-up'));
    })
    .toBe(true);

  await page.getByPlaceholder(/Guide E2E Needs Action Delivery toward the next legal action/i).fill(
    'Prioritize the release-risk summary before any new implementation work.',
  );
  await page.getByRole('button', { name: 'Record steering request' }).click();
  await expect(page.getByText('Steering request recorded')).toBeVisible();
  await expect(page.getByText('Prioritize the release-risk summary before any new implementation work.')).toBeVisible();
});
