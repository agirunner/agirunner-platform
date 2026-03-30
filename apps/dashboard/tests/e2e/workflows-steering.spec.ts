import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import {
  listWorkflowInputPackets,
  seedWorkflowsScenario,
} from './support/workflows-fixtures.js';

test('supports pause, resume, modify work, and steering requests from the workflows workbench', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Ongoing Intake').click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Workflow paused', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('Workflow resumed', { exact: true }).first()).toBeVisible();

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.getByRole('button', { name: 'Prepare blocked release brief' }).click();
  await page.getByRole('button', { name: 'Modify Work' }).click();
  await page.getByRole('button', { name: 'Add input' }).click();
  await page.getByLabel('Input name').fill('follow_up');
  await page.getByLabel('Input value').fill('Verify the follow-up path is captured.');
  await page.getByLabel('Operator note').fill('Capture the regression follow-up before resuming delivery work.');
  await page.getByRole('button', { name: 'Update work' }).click();
  await expect(page.getByText('Workflow work updated')).toBeVisible();

  await expect
    .poll(async () => {
      const packets = await listWorkflowInputPackets(scenario.needsActionWorkflow.id);
      return packets.some((packet) =>
        String(packet.summary ?? '').includes('Inputs updated for Prepare blocked release brief'),
      );
    })
    .toBe(true);

  await page.getByRole('button', { name: 'Steering' }).click();
  await expect(page.getByText('Targeting work item: Prepare blocked release brief')).toBeVisible();
  await page.getByPlaceholder(/Guide Prepare blocked release brief toward the next legal action/i).fill(
    'Prioritize the release-risk summary before any new implementation work.',
  );
  const steeringSubmitButton = page.getByRole('button', { name: 'Record steering request' });
  await steeringSubmitButton.evaluate((node) => {
    node.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
  await steeringSubmitButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Steering request recorded')).toBeVisible();
  await expect(page.getByText('Prioritize the release-risk summary before any new implementation work.')).toBeVisible();
});
