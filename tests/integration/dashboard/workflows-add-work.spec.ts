import { expect, type Page, test } from '@playwright/test';

import { loginToWorkflows, workflowRailButton } from './support/workflows-auth.js';
import {
  createSeededWorkflowInputPacket,
  createSeededWorkflowWorkItem,
  seedWorkflowsScenario,
} from './support/workflows-fixtures.js';

test.use({ viewport: { width: 1280, height: 1100 } });

test('submits workflow-scope add work through create-work-item with an embedded initial input packet', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  const createWorkRequests: Array<Record<string, unknown>> = [];
  const steeringRequests: Array<Record<string, unknown>> = [];
  const inputPacketRequests: Array<Record<string, unknown>> = [];

  await routeCreateWorkItem(page, scenario.needsActionWorkflow.id, createWorkRequests, {
    id: 'created-work-item-1',
    workflow_id: scenario.needsActionWorkflow.id,
    title: 'Prepare release risk summary',
  });
  await routeSteeringRequest(page, scenario.needsActionWorkflow.id, steeringRequests);
  await routeInputPackets(page, scenario.needsActionWorkflow.id, inputPacketRequests);

  await loginToWorkflows(page);
  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.locator('[data-workflows-top-strip="true"]').getByRole('button', { name: 'Add Work' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Add work' })).toBeVisible();
  await dialog.getByLabel('Work item title').fill('Prepare release risk summary');
  await dialog.getByRole('button', { name: 'Add input' }).click();
  await dialog.getByLabel('Input name').fill('audience');
  await dialog.getByLabel('Input value').fill('Release managers');
  await dialog.getByLabel('Operator note').fill('Start with the risk summary before the delivery memo.');
  await dialog.getByRole('button', { name: 'Add work' }).click();

  await expect.poll(() => createWorkRequests.length).toBe(1);
  await expect(createWorkRequests[0].title).toBe('Prepare release risk summary');
  await expect(createWorkRequests[0].initial_input_packet).toEqual({
    summary: 'Planned work for Prepare release risk summary',
    structured_inputs: {
      audience: 'Release managers',
    },
    files: [],
  });
  await expect(inputPacketRequests).toHaveLength(0);
  await expect.poll(() => steeringRequests.length).toBe(1);
  await expect(steeringRequests[0].work_item_id).toBe('created-work-item-1');
  await expect(steeringRequests[0].request).toBe('Start with the risk summary before the delivery memo.');
});

test('submits selected work-item modify work through an input packet and linked steering request', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  const createWorkRequests: Array<Record<string, unknown>> = [];
  const steeringRequests: Array<Record<string, unknown>> = [];
  const inputPacketRequests: Array<Record<string, unknown>> = [];

  await routeCreateWorkItem(page, scenario.needsActionWorkflow.id, createWorkRequests, {
    id: 'unexpected-work-item',
    workflow_id: scenario.needsActionWorkflow.id,
    title: 'Unexpected work item',
  });
  await routeInputPackets(page, scenario.needsActionWorkflow.id, inputPacketRequests, {
    id: 'packet-1',
  });
  await routeSteeringRequest(page, scenario.needsActionWorkflow.id, steeringRequests);

  await loginToWorkflows(page);
  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.getByRole('button', { name: 'Prepare blocked release brief' }).click();
  await page.locator('[data-workflows-top-strip="true"]').getByRole('button', { name: 'Modify Work' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Update work' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add input' }).click();
  await dialog.getByLabel('Input name').fill('revision');
  await dialog.getByLabel('Input value').fill('4');
  await dialog.getByLabel('Operator note').fill('Refocus this item on the rollback guidance before approval.');
  await dialog.getByRole('button', { name: 'Update work' }).click();

  await expect.poll(() => inputPacketRequests.length).toBe(1);
  await expect(inputPacketRequests[0].work_item_id).toBe(scenario.needsActionWorkItem.id);
  await expect(inputPacketRequests[0].packet_kind).toBe('plan_update');
  await expect(inputPacketRequests[0].structured_inputs).toEqual({
    revision: '4',
  });
  await expect(createWorkRequests).toHaveLength(0);
  await expect.poll(() => steeringRequests.length).toBe(1);
  await expect(steeringRequests[0].work_item_id).toBe(scenario.needsActionWorkItem.id);
  await expect(steeringRequests[0].linked_input_packet_ids).toEqual(['packet-1']);
});

test('prefills repeat work from the latest source input packet for non-terminal parent workflows', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  const repeatedWorkItem = await createSeededWorkflowWorkItem(scenario.needsActionWorkflow.id, {
    title: 'Repeatable release brief',
    stage_name: 'delivery',
    column_id: 'done',
    priority: 'high',
    completed_at: new Date().toISOString(),
  });
  await createSeededWorkflowInputPacket({
    workflowId: scenario.needsActionWorkflow.id,
    workItemId: repeatedWorkItem.id,
    packetKind: 'plan_update',
    summary: 'Repeat seed',
    structuredInputs: {
      audience: 'Exec review',
      summary: 'Carry forward the release brief changes.',
    },
  });

  await loginToWorkflows(page);
  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.getByRole('button', { name: 'Repeatable release brief' }).click();
  await page.locator('[data-work-item-local-control="repeat"]').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Repeat work' })).toBeVisible();
  await expect(dialog.getByLabel('Work item title')).toHaveValue('Repeatable release brief');
  await expect(dialog.getByLabel('Input name').nth(0)).toHaveValue('audience');
  await expect(dialog.getByLabel('Input value').nth(0)).toHaveValue('Exec review');
  await expect(dialog.getByLabel('Input name').nth(1)).toHaveValue('summary');
  await expect(dialog.getByLabel('Input value').nth(1)).toHaveValue(
    'Carry forward the release brief changes.',
  );
});

test('routes repeat from a terminal workflow into a new workflow launch seeded from the same context', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Planned Terminal Brief').click();
  await page.getByRole('button', { name: 'Publish terminal brief' }).click();
  await page.locator('[data-work-item-local-control="repeat"]').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'New workflow' })).toBeVisible();
  await expect(dialog.locator('label').filter({ hasText: 'Playbook' }).getByRole('button')).toContainText(
    'Planned Workflows',
  );
  await expect(dialog.locator('label').filter({ hasText: 'Workspace' }).getByRole('button')).toContainText(
    'Workflows Workspace',
  );
  await expect(dialog.getByLabel('Workflow name')).toHaveValue('Publish terminal brief');
  await expect(dialog.getByLabel('Workflow Goal')).toHaveValue(
    'Publish a terminal brief with deliverables.',
  );
});

async function routeCreateWorkItem(
  page: Page,
  workflowId: string,
  requests: Array<Record<string, unknown>>,
  responseRecord: Record<string, unknown>,
): Promise<void> {
  await page.route(`**/api/v1/workflows/${workflowId}/work-items`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: responseRecord }),
    });
  });
}

async function routeInputPackets(
  page: Page,
  workflowId: string,
  requests: Array<Record<string, unknown>>,
  responseRecord: Record<string, unknown> = { id: 'packet-seeded' },
): Promise<void> {
  await page.route(`**/api/v1/workflows/${workflowId}/input-packets`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: responseRecord }),
    });
  });
}

async function routeSteeringRequest(
  page: Page,
  workflowId: string,
  requests: Array<Record<string, unknown>>,
): Promise<void> {
  await page.route(`**/api/v1/workflows/${workflowId}/steering-requests`, async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          outcome: 'applied',
          result_kind: 'steering_request_recorded',
          source_workflow_id: workflowId,
          workflow_id: workflowId,
          resulting_work_item_id: null,
          input_packet_id: null,
          intervention_id: null,
          snapshot_version: 'seeded',
          settings_revision: 1,
          message: 'Recorded',
          redrive_lineage: null,
          steering_session_id: 'session-1',
          request_message_id: 'message-request-1',
          response_message_id: null,
          linked_intervention_ids: [],
          linked_input_packet_ids: [],
        },
      }),
    });
  });
}
