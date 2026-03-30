import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import {
  ADMIN_API_KEY,
  PLATFORM_API_URL,
} from './support/platform-env.js';
import {
  appendWorkflowEvent,
  seedWorkflowsScenario,
} from './support/workflows-fixtures.js';

test('seeds the selected workflow workspace with backend-backed live console and brief records', async () => {
  const scenario = await seedWorkflowsScenario();
  const response = await fetch(
    `${PLATFORM_API_URL}/api/v1/operations/workflows/${scenario.ongoingWorkflow.id}/workspace?tab_scope=workflow`,
    {
      headers: {
        authorization: `Bearer ${ADMIN_API_KEY}`,
      },
    },
  );
  expect(response.ok).toBeTruthy();
  const payload = await response.json() as {
    data: {
      live_console: { items: Array<{ headline: string }> };
      briefs: { items: Array<{ headline: string }> };
    };
  };

  expect(payload.data.live_console.items.some((item) => item.headline.includes('Initial execution burst'))).toBeTruthy();
  expect(payload.data.briefs.items.some((item) => item.headline.includes('Shift handoff'))).toBeTruthy();
});

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
