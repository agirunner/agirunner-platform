import { Buffer } from 'node:buffer';

import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from '../lib/workflows-auth.js';
import {
  listWorkflowInputPackets,
  seedWorkflowsScenario,
} from '../lib/workflows-fixtures.js';

test.use({ viewport: { width: 1280, height: 1100 } });

test('records work-item steering from the local card control instead of a steering tab', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.getByRole('button', { name: 'Prepare blocked release brief' }).click();
  await page.locator('[data-work-item-local-control="steer"]').click();

  const steeringDialog = page.getByRole('dialog');
  await expect(steeringDialog.getByRole('heading', { name: 'Steer work item' })).toBeVisible();
  await expect(steeringDialog.getByText('Work item · Prepare blocked release brief').first()).toBeVisible();
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

test('stores steering attachments as linked input packets and exposes them in the selected work item scope', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.getByRole('button', { name: 'Prepare blocked release brief' }).click();
  await page.locator('[data-work-item-local-control="steer"]').click();

  const steeringDialog = page.getByRole('dialog');
  await steeringDialog
    .getByPlaceholder(/Guide Prepare blocked release brief toward the next legal action/i)
    .fill('Attach the rollback appendix and then wait for operator approval.');
  await steeringDialog.locator('input[type="file"]').setInputFiles({
    name: 'rollback-appendix.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Rollback appendix\nValidate the recovery steps before approval.\n', 'utf8'),
  });
  await expect(steeringDialog.getByText('rollback-appendix.md')).toBeVisible();
  await steeringDialog.getByRole('button', { name: 'Record steering request' }).click();

  await expect(page.getByText('Steering request recorded')).toBeVisible();
  await expect
    .poll(async () => {
      const packets = await listWorkflowInputPackets(scenario.needsActionWorkflow.id) as Array<{
        work_item_id?: string | null;
        summary?: string | null;
        files?: Array<{ file_name?: string | null }>;
      }>;
      return packets.some(
        (packet) =>
          packet.work_item_id === scenario.needsActionWorkItem.id
          && packet.summary === 'Steering attachments for work item: Prepare blocked release brief'
          && (packet.files ?? []).some((file) => file.file_name === 'rollback-appendix.md'),
      );
    })
    .toBe(true);

  await page.getByRole('tab', { name: 'Details' }).click();
  await expect(
    page.locator('[data-workflows-workbench-frame="true"]').getByRole('link', { name: 'rollback-appendix.md' }),
  ).toBeVisible();
});

test('routes needs-action through local work-item controls while keeping workflow pause and resume global', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Ongoing Intake').click();
  await page
    .locator('[data-workflows-top-strip="true"]')
    .getByRole('button', { name: 'Pause' })
    .click();
  await page.getByRole('button', { name: 'Confirm pause' }).click();
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
