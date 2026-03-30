import { expect, type Page, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import { seedWorkflowsScenario } from './support/workflows-fixtures.js';

test.use({ viewport: { width: 1280, height: 1100 } });

test('submits positive and negative approval responses from the workflow needs-action UI', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let workspaceState = 0;

  await routeNeedsActionWorkspace(page, scenario.needsActionWorkflow.id, () => (
    workspaceState === 0
      ? [buildApprovalItem({
        workItemId: 'work-item-approval-1',
        taskId: 'task-approval-1',
        workItemTitle: 'Prepare blocked release brief',
        taskTitle: 'Approve release packet',
        verification: 'Release packet verification passed and the required artifacts are attached.',
      })]
      : workspaceState === 1
        ? [buildApprovalItem({
          workItemId: 'work-item-approval-2',
          taskId: 'task-approval-2',
          workItemTitle: 'Prepare blocked release brief',
          taskTitle: 'Approve compliance memo',
          verification: 'Compliance memo verification passed and the latest policy notes are attached.',
        })]
        : []
  ));
  await routeNeedsActionMutation(
    page,
    `**/api/v1/workflows/${scenario.needsActionWorkflow.id}/work-items/work-item-approval-1/tasks/task-approval-1/approve`,
    () => {
      workspaceState = 1;
    },
    requests,
  );
  await routeNeedsActionMutation(
    page,
    `**/api/v1/workflows/${scenario.needsActionWorkflow.id}/work-items/work-item-approval-2/tasks/task-approval-2/request-changes`,
    () => {
      workspaceState = 2;
    },
    requests,
  );

  await loginToWorkflows(page);
  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await workbench.getByRole('button', { name: /Needs Action/ }).click();

  await expect(workbench.getByText('Approve release packet.', { exact: true })).toBeVisible();
  await workbench.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => requests[0]?.url ?? '').toContain(
    `/api/v1/workflows/${scenario.needsActionWorkflow.id}/work-items/work-item-approval-1/tasks/task-approval-1/approve`,
  );
  await expect(workbench.getByText('Approve release packet.', { exact: true })).toHaveCount(0);
  await expect(workbench.getByText('Approve compliance memo.', { exact: true })).toBeVisible();

  await workbench.getByRole('button', { name: 'Request changes' }).first().click();
  await workbench.getByRole('button', { name: 'Request changes' }).last().click();
  await expect(page.getByText('Enter review feedback before continuing.')).toBeVisible();
  const approvalFeedbackInput = page.getByPlaceholder('Describe the changes or rejection reason...');
  await approvalFeedbackInput.fill(
    'Add the missing rollback note before resubmitting this approval packet.',
  );
  await workbench.getByRole('button', { name: 'Request changes' }).last().click();
  await expect.poll(() => requests[1]?.url ?? '').toContain(
    `/api/v1/workflows/${scenario.needsActionWorkflow.id}/work-items/work-item-approval-2/tasks/task-approval-2/request-changes`,
  );
  await expect.poll(() => requests[1]?.body?.feedback ?? '').toBe(
    'Add the missing rollback note before resubmitting this approval packet.',
  );
  await expect(workbench.getByText('Approve compliance memo.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Nothing in this workflow requires operator action right now.')).toBeVisible();
});

test('validates and submits escalation guidance from the workflow needs-action UI', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let resolved = false;

  await routeNeedsActionWorkspace(page, scenario.needsActionWorkflow.id, () => (
    resolved
      ? []
      : [buildEscalationItem()]
  ));
  await routeNeedsActionMutation(
    page,
    `**/api/v1/workflows/${scenario.needsActionWorkflow.id}/work-items/work-item-escalation-1/tasks/task-escalation-1/resolve-escalation`,
    () => {
      resolved = true;
    },
    requests,
  );

  await loginToWorkflows(page);
  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await workbench.getByRole('button', { name: /Needs Action/ }).click();

  await expect(page.getByText('Resolve escalation', { exact: true })).toBeVisible();
  await expect(page.getByText('submit_handoff replay mismatch conflict')).toBeVisible();
  await workbench.getByRole('button', { name: 'Resume with guidance' }).click();
  await workbench.getByRole('button', { name: 'Resume task' }).click();
  await expect(page.getByText('Enter operator guidance before continuing.')).toBeVisible();
  await expect(requests).toHaveLength(0);
  const escalationGuidanceInput = page.getByPlaceholder(
    'Describe the guidance the specialist or orchestrator should follow next...',
  );
  await escalationGuidanceInput.fill(
    'Continue from the persisted handoff and reuse the stored request id before resubmitting.',
  );
  await workbench.getByRole('button', { name: 'Resume task' }).click();
  await expect.poll(() => requests[0]?.url ?? '').toContain(
    `/api/v1/workflows/${scenario.needsActionWorkflow.id}/work-items/work-item-escalation-1/tasks/task-escalation-1/resolve-escalation`,
  );
  await expect.poll(() => requests[0]?.body?.instructions ?? '').toBe(
    'Continue from the persisted handoff and reuse the stored request id before resubmitting.',
  );
  await expect(page.getByText('Resolve escalation')).toHaveCount(0);
  await expect(page.getByText('Nothing in this workflow requires operator action right now.')).toBeVisible();
});

async function routeNeedsActionWorkspace(
  page: Page,
  workflowId: string,
  readItems: () => Array<Record<string, unknown>>,
): Promise<void> {
  const workspacePattern = new RegExp(`/api/v1/operations/workflows/${workflowId}/workspace(?:\\?.*)?$`);

  await page.route(workspacePattern, async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as { data: Record<string, unknown> };
    const items = readItems();
    applyNeedsActionPatch(payload.data, items);
    await route.fulfill({ response, json: payload });
  });
}

async function routeNeedsActionMutation(
  page: Page,
  urlPattern: string,
  afterRequest: () => void,
  requests: Array<{ url: string; body: Record<string, unknown> }>,
): Promise<void> {
  await page.route(urlPattern, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push({
      url: route.request().url(),
      body,
    });
    afterRequest();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { ok: true } }),
    });
  });
}

function applyNeedsActionPatch(packet: Record<string, unknown>, items: Array<Record<string, unknown>>): void {
  const bottomTabs = packet.bottom_tabs as Record<string, unknown>;
  const counts = bottomTabs.counts as Record<string, unknown>;
  const needsAction = packet.needs_action as Record<string, unknown>;

  needsAction.items = items;
  needsAction.total_count = items.length;
  needsAction.scope_summary = {
    workflow_total_count: items.length,
    selected_scope_total_count: items.length,
    scoped_away_workflow_count: 0,
  };
  counts.needs_action = items.length;
}

function buildApprovalItem(input: {
  workItemId: string;
  taskId: string;
  workItemTitle: string;
  taskTitle: string;
  verification: string;
}): Record<string, unknown> {
  return {
    action_id: `${input.taskId}:awaiting_approval`,
    action_kind: 'review_work_item',
    label: 'Approval required',
    summary: `${input.workItemTitle} is waiting for operator approval on ${input.taskTitle}.`,
    target: {
      target_kind: 'task',
      target_id: input.taskId,
    },
    priority: 'high',
    requires_confirmation: true,
    submission: {
      route_kind: 'task_mutation',
      method: 'POST',
    },
    details: [
      { label: 'Approval target', value: input.taskTitle },
      { label: 'Context', value: `${input.taskTitle} is assembled and waiting for a human decision.` },
      { label: 'Verification', value: input.verification },
      { label: 'Revision', value: '3' },
    ],
    responses: [
      {
        action_id: `${input.taskId}:approve_task`,
        kind: 'approve_task',
        label: 'Approve',
        work_item_id: input.workItemId,
        target: {
          target_kind: 'task',
          target_id: input.taskId,
        },
        requires_confirmation: false,
        prompt_kind: 'none',
      },
      {
        action_id: `${input.taskId}:request_changes_task`,
        kind: 'request_changes_task',
        label: 'Request changes',
        work_item_id: input.workItemId,
        target: {
          target_kind: 'task',
          target_id: input.taskId,
        },
        requires_confirmation: true,
        prompt_kind: 'feedback',
      },
    ],
  };
}

function buildEscalationItem(): Record<string, unknown> {
  return {
    action_id: 'work-item-escalation-1:open_escalation',
    action_kind: 'resolve_escalation',
    label: 'Resolve escalation',
    summary: 'Prepare blocked release brief needs escalation resolution: submit_handoff replay mismatch conflict.',
    target: {
      target_kind: 'task',
      target_id: 'task-escalation-1',
    },
    priority: 'high',
    requires_confirmation: false,
    submission: {
      route_kind: 'task_mutation',
      method: 'POST',
    },
    details: [
      { label: 'Context', value: 'Persisted handoff exists and the release summary is already written.' },
      { label: 'Work so far', value: 'Reviewed the current attempt, compared request ids, and identified the replay mismatch.' },
    ],
    responses: [
      {
        action_id: 'task-escalation-1:resolve_escalation',
        kind: 'resolve_escalation',
        label: 'Resume with guidance',
        work_item_id: 'work-item-escalation-1',
        target: {
          target_kind: 'task',
          target_id: 'task-escalation-1',
        },
        requires_confirmation: true,
        prompt_kind: 'instructions',
      },
    ],
  };
}
