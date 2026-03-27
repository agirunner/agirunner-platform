import { expect, test } from '@playwright/test';

import { loginToDashboard } from './support/mission-control-auth.js';
import {
  listWorkflowInputPackets,
  listWorkflowInterventions,
  seedMissionControlScenario,
} from './support/mission-control-fixtures.js';

test('supports overview, outputs, add-work, and steering flows for a selected workflow', async ({ page }) => {
  const scenario = await seedMissionControlScenario();
  await loginToDashboard(page);

  await page.getByRole('link', { name: 'Open E2E Blocked Delivery workflow' }).click();

  await expect(page.getByRole('heading', { name: 'E2E Blocked Delivery' })).toBeVisible();
  await expect(page.getByText('Current operator ask')).toBeVisible();
  await expect(page.getByText('Latest output')).toBeVisible();
  await expect(page.getByLabel('Overview').getByText('Release brief')).toBeVisible();

  await page.getByRole('tab', { name: 'Board' }).click();
  const blockedWorkItem = page.locator('article').filter({ hasText: 'Prepare blocked release brief' });
  await expect(blockedWorkItem).toBeVisible();
  await expect(blockedWorkItem.getByText('Blocked', { exact: true })).toBeVisible();
  await expect(blockedWorkItem.getByText(/operator should provide rollback guidance/i)).toBeVisible();

  await page.getByRole('tab', { name: 'Outputs' }).click();
  await expect(page.getByText('Deliverables')).toBeVisible();
  await expect(page.getByRole('link', { name: 'External URL' })).toBeVisible();
  await expect(page.getByText('Release brief published for operator review')).toBeVisible();

  await page.getByRole('tab', { name: 'Steering' }).click();
  await expect(page.getByText('Workflow inputs')).toBeVisible();
  await expect(page.getByText('brief.md')).toBeVisible();

  await page.getByRole('button', { name: 'Add work' }).click();
  await page.getByLabel('Title').fill('Regression follow-up');
  await page.getByLabel('Goal').fill('Verify the follow-up path is captured.');
  await page.getByRole('button', { name: 'Add work' }).last().click();
  await expect(page.getByText('Work item added')).toBeVisible();

  await expect
    .poll(async () => {
      const packets = await listWorkflowInputPackets(scenario.blockedWorkflow.id);
      return packets.some((packet) => String(packet.summary ?? '').includes('Regression follow-up'));
    })
    .toBe(true);

  await page.getByPlaceholder(/Focus on the validation path first/i).fill(
    'Focus on the regression follow-up before any new release work.',
  );
  await page.getByRole('button', { name: 'Record steering instruction' }).click();
  await expect(page.getByText('Steering instruction recorded')).toBeVisible();
  await expect(
    page
      .getByRole('article')
      .filter({ hasText: 'Operator note' })
      .getByText('Focus on the regression follow-up before any new release work.'),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const interventions = await listWorkflowInterventions(scenario.blockedWorkflow.id);
      return interventions.some((entry) =>
        String(entry.note ?? '').includes('Focus on the regression follow-up before any new release work.'),
      );
    })
    .toBe(true);
});
