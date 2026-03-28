import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import {
  appendWorkflowEvent,
  seedWorkflowsScenario,
} from './support/workflows-fixtures.js';

test('surfaces new live console headlines when the stream receives fresh workflow events', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Ongoing Intake').click();
  await expect(page.getByText('Initial execution burst')).toBeVisible();

  const consolePanel = page.locator('div').filter({ hasText: 'Initial execution burst' }).last();
  await consolePanel.evaluate((element) => {
    element.scrollTop = 0;
  });

  await appendWorkflowEvent(scenario.ongoingWorkflow.id, 'workflow.live_console', {
    headline: 'Fresh workflow headline',
    summary: 'Realtime update pushed after the workflow was already selected.',
  });

  await expect(page.getByRole('button', { name: 'New updates' })).toBeVisible();
  await page.getByRole('button', { name: 'New updates' }).click();
  await expect(page.getByText('Fresh workflow headline')).toBeVisible();
});
