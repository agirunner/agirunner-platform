import { randomUUID } from 'node:crypto';

import { expect, test, type Page, type Response } from '@playwright/test';

import { ADMIN_API_KEY, DEFAULT_TENANT_ID, PLATFORM_API_URL } from '../lib/platform-env.js';
import { createPlaybook, createWorkflowViaApi, seedWorkflowsScenario } from '../lib/workflows-fixtures.js';
import { loginToWorkflows, workflowRailButton } from '../lib/workflows-auth.js';
import { runPsql } from '../lib/workflows-runtime.js';

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
  const directPlaybookRows = await listRailRowNames({
    mode: 'live',
    per_page: '200',
    playbook_id: alternatePlaybook.id,
  });

  expect(directPlaybookRows).toContain('E2E Alternate Playbook Workflow');
  expect(directPlaybookRows.every((name) => name === 'E2E Alternate Playbook Workflow')).toBeTruthy();

  await loginToWorkflows(page);
  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await expect(page.locator('aside button').filter({ hasText: 'E2E Needs Action Delivery' })).toBeVisible();

  const railResponsePromise = waitForRailResponse(page, (url) =>
    url.searchParams.get('playbook_id') === alternatePlaybook.id,
  );

  await openRailFilters(page);
  await page.getByRole('button', { name: 'All playbooks' }).click();
  await page.getByRole('option', { name: alternatePlaybook.name }).click();

  const railResponse = await railResponsePromise;
  expect((await readRailPayload(railResponse)).data).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`playbook_id=${alternatePlaybook.id}`));
  await expect(page.getByText(`Playbook: ${alternatePlaybook.name}`)).toBeVisible();
  await expect(workflowRailButton(page, 'E2E Alternate Playbook Workflow')).toBeVisible();
  await expect(workflowRailButton(page, 'E2E Needs Action Delivery')).toHaveCount(0);
});

test('filters stale workflows out of the rail when recency filters are applied', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  const recentWorkflowName = 'E2E Recent Rail Workflow';
  const staleWorkflowName = 'E2E Stale Rail Workflow';
  insertRailWorkflow({
    id: randomUUID(),
    workflowName: recentWorkflowName,
    workspaceId: scenario.workspace.id,
    playbookId: scenario.plannedPlaybook.id,
    createdAtSql: 'NOW()',
    updatedAtSql: 'NOW()',
  });
  insertRailWorkflow({
    id: randomUUID(),
    workflowName: staleWorkflowName,
    workspaceId: scenario.workspace.id,
    playbookId: scenario.plannedPlaybook.id,
    createdAtSql: "NOW() - INTERVAL '45 days'",
    updatedAtSql: "NOW() - INTERVAL '45 days'",
  });
  const directRecencyRows = await listRailRowNames({
    mode: 'live',
    per_page: '200',
    updated_within: '7d',
  });

  expect(directRecencyRows).toContain(recentWorkflowName);
  expect(directRecencyRows).not.toContain(staleWorkflowName);

  await loginToWorkflows(page);

  const railResponsePromise = waitForRailResponse(page, (url) =>
    url.searchParams.get('updated_within') === '7d',
  );

  await openRailFilters(page);
  await page.getByRole('button', { name: '7d' }).click();

  const railResponse = await railResponsePromise;
  expect((await readRailPayload(railResponse)).data).toBeTruthy();
  await expect(page).toHaveURL(/updated_within=7d/);
  await expect(page.getByText('Updated 7d')).toBeVisible();
  await expect(workflowRailButton(page, recentWorkflowName)).toBeVisible();
  await expect(workflowRailButton(page, staleWorkflowName)).toHaveCount(0);
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

async function listRailRowNames(
  params: Record<string, string>,
): Promise<string[]> {
  const search = new URLSearchParams(params);
  const response = await fetch(`${PLATFORM_API_URL}/api/v1/operations/workflows?${search.toString()}`, {
    headers: {
      authorization: `Bearer ${ADMIN_API_KEY}`,
    },
  });
  expect(response.ok).toBeTruthy();
  const payload = (await response.json()) as {
    data?: {
      rows?: Array<{ name: string }>;
      ongoing_rows?: Array<{ name: string }>;
    };
  };
  return [
    ...(payload.data?.rows ?? []).map((row) => row.name),
    ...(payload.data?.ongoing_rows ?? []).map((row) => row.name),
  ];
}

function insertRailWorkflow(input: {
  id: string;
  workflowName: string;
  workspaceId: string;
  playbookId: string;
  createdAtSql: string;
  updatedAtSql: string;
}): void {
  runPsql(`
    INSERT INTO public.workflows (
      id,
      tenant_id,
      workspace_id,
      playbook_id,
      name,
      state,
      lifecycle,
      current_stage,
      parameters,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      '${input.id}'::uuid,
      '${DEFAULT_TENANT_ID}'::uuid,
      '${input.workspaceId}'::uuid,
      '${input.playbookId}'::uuid,
      '${input.workflowName.replace(/'/g, "''")}',
      'completed'::workflow_state,
      'planned',
      'delivery',
      '{"workflow_goal":"Exercise workflows rail recency filtering."}'::jsonb,
      '{}'::jsonb,
      ${input.createdAtSql},
      ${input.updatedAtSql}
    );
  `);
}
