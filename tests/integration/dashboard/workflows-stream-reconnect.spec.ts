import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import {
  appendWorkflowEvent,
  seedWorkflowsScenario,
} from './support/workflows-fixtures.js';

test('recovers from a dropped workflow stream and backfills later updates', async ({ page }) => {
  await page.route('**/api/v1/operations/workflows/**/stream**', async (route) => {
    await route.abort();
  });

  const scenario = await seedWorkflowsScenario();
  await loginToWorkflows(page);
  await workflowRailButton(page, 'E2E Ongoing Intake').click();

  await page.unroute('**/api/v1/operations/workflows/**/stream**');
  await appendWorkflowEvent(scenario.ongoingWorkflow.id, 'workflow.live_console', {
    headline: 'Recovered workflow stream',
    summary: 'The workflow stream dropped and later resumed.',
  });

  await expect(page.getByText('Recovered workflow stream')).toBeVisible();
});
