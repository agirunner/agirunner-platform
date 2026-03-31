import { expect, test } from '@playwright/test';

import {
  ADMIN_API_KEY,
  PLATFORM_API_URL,
} from './support/platform-env.js';
import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import { appendWorkflowExecutionTurn, appendWorkflowEvent, seedWorkflowsScenario } from './support/workflows-fixtures.js';

test('recovers from a dropped workflow stream and backfills later updates', async ({ page }) => {
  await page.route('**/api/v1/operations/workflows/**/stream**', async (route) => {
    await route.abort();
  });

  const scenario = await seedWorkflowsScenario();
  const workspacePattern = new RegExp(
    `/api/v1/operations/workflows/${scenario.ongoingWorkflow.id}/workspace(?:\\?.*)?$`,
  );
  const streamPattern = new RegExp(
    `/api/v1/operations/workflows/${scenario.ongoingWorkflow.id}/stream(?:\\?.*)?$`,
  );
  await loginToWorkflows(page);
  await workflowRailButton(page, 'E2E Ongoing Intake').click();
  await page.getByRole('tab', { name: 'Live Console' }).click();
  await expect(page.getByText('Initial execution burst')).toBeVisible();

  const reconnectedStream = page.waitForResponse((response) =>
    response.request().method() === 'GET'
    && streamPattern.test(response.url())
    && response.status() === 200,
  );
  await page.unroute('**/api/v1/operations/workflows/**/stream**');
  await appendWorkflowExecutionTurn({
    workflowId: scenario.ongoingWorkflow.id,
    workflowName: scenario.ongoingWorkflow.name ?? 'E2E Ongoing Intake',
    workspaceId: scenario.workspace.id,
    workspaceName: scenario.workspace.name ?? 'Workflows Workspace',
    workItemId: scenario.ongoingWorkItem.id,
    taskTitle: 'Triage intake queue',
    stageName: 'intake',
    role: 'intake-analyst',
    actorName: 'Intake Analyst',
    headline: 'Recovered workflow stream',
  });
  await appendWorkflowEvent(scenario.ongoingWorkflow.id, 'workflow.live_console', {
    headline: 'Recovered workflow stream',
    summary: 'The workflow stream dropped and later resumed.',
  });
  await reconnectedStream;

  const refreshedWorkspace = await page.waitForResponse((response) =>
    response.request().method() === 'GET'
    && workspacePattern.test(response.url())
    && response.status() === 200,
  );
  const workspaceResponse = await fetch(
    `${PLATFORM_API_URL}/api/v1/operations/workflows/${scenario.ongoingWorkflow.id}/workspace?tab_scope=workflow`,
    {
      headers: {
        authorization: `Bearer ${ADMIN_API_KEY}`,
      },
    },
  );
  expect(workspaceResponse.ok).toBeTruthy();
  const workspacePayload = await workspaceResponse.json() as {
    data: {
      live_console: {
        items: Array<{ headline: string }>;
      };
    };
  };
  const refreshedWorkspacePayload = await refreshedWorkspace.json() as {
    data: {
      live_console: {
        items: Array<{ headline: string }>;
      };
    };
  };

  expect(
    workspacePayload.data.live_console.items.some((item) => item.headline.includes('Recovered workflow stream')),
  ).toBeTruthy();
  expect(
    refreshedWorkspacePayload.data.live_console.items.some((item) => item.headline.includes('Recovered workflow stream')),
  ).toBeTruthy();

  await expect(page.locator('[data-live-console-surface="terminal"]')).toContainText('Recovered workflow stream');
});
