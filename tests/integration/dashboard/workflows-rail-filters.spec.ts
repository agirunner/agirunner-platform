import { expect, test, type Page, type Response } from '@playwright/test';

import { createPlaybook, createWorkflowViaApi, seedWorkflowsScenario } from './support/workflows-fixtures.js';
import { loginToWorkflows, workflowRailButton } from './support/workflows-auth.js';
import { runPsql } from './support/workflows-runtime.js';

test('filters the workflows rail by playbook through the advanced filters popover', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  const alternatePlaybook = await createPlaybook({
    name: `Alternate Delivery ${Date.now().toString(36)}`,
    slug: `alternate-delivery-${Date.now().toString(36)}`,
    lifecycle: 'planned',
  });
  await createWorkflowViaApi({
    name: 'E2E Alternate Playbook Workflow',
    playbookId: alternatePlaybook.id,
    workspaceId: scenario.workspace.id,
    lifecycle: 'planned',
    state: 'completed',
    parameters: {
      workflow_goal: 'Exercise the playbook filter in the workflows rail.',
    },
  });

  await loginToWorkflows(page);

  const railResponsePromise = waitForRailResponse(page, (url) =>
    url.searchParams.get('playbook_id') === alternatePlaybook.id,
  );

  await openRailFilters(page);
  await page.getByRole('button', { name: 'All playbooks' }).click();
  await page.getByRole('option', { name: alternatePlaybook.name }).click();

  const railResponse = await railResponsePromise;
  const payload = await readRailPayload(railResponse);

  expect(payload.data?.rows?.every((row) => row.playbook_name === alternatePlaybook.name)).toBeTruthy();
  expect(payload.data?.ongoing_rows?.every((row) => row.playbook_name === alternatePlaybook.name)).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`playbook_id=${alternatePlaybook.id}`));
  await expect(page.getByText(`Playbook: ${alternatePlaybook.name}`)).toBeVisible();
  await expect(workflowRailButton(page, 'E2E Alternate Playbook Workflow')).toBeVisible();
});

test('filters stale workflows out of the rail when recency filters are applied', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  const recentWorkflow = await createWorkflowViaApi({
    name: 'E2E Recent Rail Workflow',
    playbookId: scenario.plannedPlaybook.id,
    workspaceId: scenario.workspace.id,
    lifecycle: 'planned',
    state: 'completed',
    parameters: {
      workflow_goal: 'Stay visible under the 7d filter.',
    },
  });
  const staleWorkflow = await createWorkflowViaApi({
    name: 'E2E Stale Rail Workflow',
    playbookId: scenario.plannedPlaybook.id,
    workspaceId: scenario.workspace.id,
    lifecycle: 'planned',
    state: 'completed',
    parameters: {
      workflow_goal: 'Disappear under the 7d filter.',
    },
  });
  runPsql(`
    UPDATE public.workflows
       SET updated_at = NOW() - INTERVAL '45 days'
     WHERE id = '${staleWorkflow.id}'::uuid;
  `);
  runPsql(`
    UPDATE public.workflows
       SET updated_at = NOW()
     WHERE id = '${recentWorkflow.id}'::uuid;
  `);

  await loginToWorkflows(page);

  const railResponsePromise = waitForRailResponse(page, (url) =>
    url.searchParams.get('updated_within') === '7d',
  );

  await openRailFilters(page);
  await page.getByRole('button', { name: '7d' }).click();

  const railResponse = await railResponsePromise;
  const payload = await readRailPayload(railResponse);
  const rowNames = [
    ...(payload.data?.rows ?? []).map((row) => row.name),
    ...(payload.data?.ongoing_rows ?? []).map((row) => row.name),
  ];

  expect(rowNames).toContain('E2E Recent Rail Workflow');
  expect(rowNames).not.toContain('E2E Stale Rail Workflow');
  await expect(page).toHaveURL(/updated_within=7d/);
  await expect(page.getByText('Updated 7d')).toBeVisible();
  await expect(workflowRailButton(page, 'E2E Recent Rail Workflow')).toBeVisible();
  await expect(workflowRailButton(page, 'E2E Stale Rail Workflow')).toHaveCount(0);
});

async function openRailFilters(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Filters/ }).click();
  await expect(page.getByText('Server-driven rail filters for large workflow sets.')).toBeVisible();
}

function waitForRailResponse(
  page: Page,
  predicate: (url: URL) => boolean,
): Promise<Response> {
  return page.waitForResponse((response) => {
    if (response.request().method() !== 'GET') {
      return false;
    }
    const url = new URL(response.url());
    return url.pathname === '/api/v1/operations/workflows' && predicate(url);
  });
}

async function readRailPayload(response: Response): Promise<{
  data?: {
    rows?: Array<{ name: string; playbook_name?: string }>;
    ongoing_rows?: Array<{ name: string; playbook_name?: string }>;
  };
}> {
  return response.json() as Promise<{
    data?: {
      rows?: Array<{ name: string; playbook_name?: string }>;
      ongoing_rows?: Array<{ name: string; playbook_name?: string }>;
    };
  }>;
}
