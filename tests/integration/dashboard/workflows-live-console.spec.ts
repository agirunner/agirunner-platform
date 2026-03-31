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
  appendWorkflowExecutionTurn,
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

test('keeps task-linked briefs visible when the selected work item is attributed only through its child task', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  const response = await fetch(
    `${PLATFORM_API_URL}/api/v1/operations/workflows/${scenario.ongoingWorkflow.id}/workspace?tab_scope=selected_work_item&work_item_id=${scenario.ongoingSecondaryWorkItem.id}`,
    {
      headers: {
        authorization: `Bearer ${ADMIN_API_KEY}`,
      },
    },
  );
  expect(response.ok).toBeTruthy();
  const payload = await response.json() as {
    data: {
      briefs: { total_count: number; items: Array<{ headline: string }> };
      bottom_tabs: { counts: { briefs: number } };
    };
  };

  expect(payload.data.briefs.total_count).toBe(1);
  expect(payload.data.bottom_tabs.counts.briefs).toBe(1);
  expect(payload.data.briefs.items.map((item) => item.headline)).toContain('Overflow queue brief');

  await loginToWorkflows(page);
  await workflowRailButton(page, 'E2E Ongoing Intake').click();
  await page
    .locator('[data-work-item-card="true"]')
    .filter({ hasText: 'Triage overflow queue' })
    .first()
    .click();
  await page.getByRole('tab', { name: 'Live Console' }).click();

  await expect(page.getByText('Overflow queue brief')).toBeVisible();
});

test('surfaces new live console headlines when the stream receives fresh workflow events', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Ongoing Intake').click();
  await page.getByRole('tab', { name: 'Live Console' }).click();
  await expect(page.getByText('Initial execution burst')).toBeVisible();
  await expect(page.getByText('Shift handoff')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New updates' })).toHaveCount(0);
  await expect(page.getByTitle('Follow the latest terminal output')).toBeVisible();
  await expect(page.getByTitle('Pause terminal follow mode')).toBeVisible();

  const consolePanel = page.locator('div').filter({ hasText: 'Initial execution burst' }).last();
  await consolePanel.evaluate((element) => {
    element.scrollTop = 0;
  });

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
    headline: 'Fresh workflow headline',
  });

  await appendWorkflowEvent(scenario.ongoingWorkflow.id, 'workflow.live_console', {
    headline: 'Fresh workflow headline',
    summary: 'Realtime update pushed after the workflow was already selected.',
  });

  await expect(page.getByText('Fresh workflow headline')).toBeVisible();
});
