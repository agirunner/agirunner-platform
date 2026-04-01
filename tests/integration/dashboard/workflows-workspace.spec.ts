import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import {
  createTask,
  seedWorkflowsScenario,
  setWorkflowState,
} from './support/workflows-fixtures.js';

test('restores workflow scope, selected work item, and tab state across refresh and live console', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.getByRole('button', { name: 'Prepare blocked release brief' }).click();
  await expect(page).toHaveURL(/workflows\/.+\?work_item_id=.*tab=details/);
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await expect(workbench.getByRole('tablist')).toBeVisible();
  await expect(workbench.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
  await expect(workbench.getByText('Work item · Prepare blocked release brief')).toBeVisible();
  await expect(workbench.getByText(/what was asked/i)).toBeVisible();

  await page.reload();
  await expect(workbench.getByText('Work item · Prepare blocked release brief')).toBeVisible();
  await expect(workbench.getByText(/what was asked/i)).toBeVisible();

  await page.getByRole('tab', { name: 'Live Console' }).click();
  await expect(page).toHaveURL(/tab=live_console/);
});

test('opens a steer composer with inputs directly from the work-item card action', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();

  const workItemCard = page
    .locator('[data-work-item-card="true"]')
    .filter({ hasText: 'Prepare blocked release brief' })
    .first();

  await expect(workItemCard).toBeVisible();
  await workItemCard.getByRole('button', { name: 'Steer work item' }).click();

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Steer work item' })).toBeVisible();
  await expect(page.getByLabel('Operator guidance')).toBeVisible();
  await expect(page.getByLabel('Operator guidance')).toHaveAttribute(
    'placeholder',
    /Guide Prepare blocked release brief toward the next legal action\./,
  );
});

test('shows only legal workflow controls for paused workflows and keeps paused work visible on the board', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Paused Intake Review').click();

  const stateStrip = page.locator('[data-workflows-top-strip="true"]');
  const board = page.locator('[data-workflows-board-frame="true"]');
  const pausedCard = board.locator('[data-work-item-card="true"]').filter({ hasText: 'Paused intake review' }).first();

  await expect(stateStrip.getByRole('button', { name: 'Resume' })).toBeVisible();
  await expect(stateStrip.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(stateStrip.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  await expect(pausedCard).toBeVisible();
  await expect(pausedCard.locator('.inline-flex').filter({ hasText: /^Paused$/ }).first()).toBeVisible();
  await expect(pausedCard.locator('[data-work-item-local-control="pause"]')).toHaveCount(0);
  await expect(pausedCard.locator('[data-work-item-local-control="resume"]')).toHaveCount(0);
});

test('shows cancelled workflows as terminal and removes workflow lifecycle controls', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Cancelled Packet Review').click();

  const stateStrip = page.locator('[data-workflows-top-strip="true"]');
  const board = page.locator('[data-workflows-board-frame="true"]');
  const cancelledCard = board
    .locator('[data-work-item-card="true"]')
    .filter({ hasText: 'Cancelled packet review' })
    .first();

  await expect(stateStrip.locator('.inline-flex').filter({ hasText: /^Cancelled$/ }).first()).toBeVisible();
  await expect(stateStrip.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  await expect(stateStrip.getByRole('button', { name: 'Resume' })).toHaveCount(0);
  await expect(stateStrip.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(cancelledCard).toBeVisible();
  await expect(cancelledCard.locator('.inline-flex').filter({ hasText: /^Cancelled$/ }).first()).toBeVisible();
});

test('shows the ongoing lifecycle badge in the workflow metadata row', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Ongoing Intake').click();

  const stateStrip = page.locator('[data-workflows-top-strip="true"]');
  const headerMeta = stateStrip.locator('[data-workflow-header-meta="true"]');

  await expect(headerMeta).toContainText('Playbook');
  await expect(headerMeta).toContainText('Updated');
  await expect(headerMeta.locator('.inline-flex').filter({ hasText: /^Ongoing$/ }).first()).toBeVisible();
});

test('suppresses stale in-progress task copy for terminal work-item cards', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  await createTask({
    workflowId: scenario.cancelledWorkflow.id,
    workspaceId: scenario.workspace.id,
    workItemId: scenario.cancelledWorkItem.id,
    stageName: 'delivery',
    title: 'Implement fix for 60-second audit export timeout',
    role: 'orchestrator',
    state: 'in_progress',
    description: 'Stale deterministic task used to prove terminal cards do not show active copy.',
  });
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Cancelled Packet Review').click();

  const board = page.locator('[data-workflows-board-frame="true"]');
  const cancelledCard = board
    .locator('[data-work-item-card="true"]')
    .filter({ hasText: 'Cancelled packet review' })
    .first();

  await expect(cancelledCard).toBeVisible();
  await expect(cancelledCard).not.toContainText('Working now:');
  await expect(cancelledCard).not.toContainText('Active specialist');
  await expect(cancelledCard).not.toContainText('In Progress');
  await expect(cancelledCard).not.toContainText('Orchestrator working');
});

test('humanizes orchestrator-only in-flight workflows in the rail and workspace header', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  const row = page.getByRole('button', { name: /E2E Orchestrator Setup/ }).first();
  await expect(row).toContainText('Orchestrator working');
  await row.click();

  const stateStrip = page.locator('[data-workflows-top-strip="true"]');
  await expect(stateStrip.getByText('Orchestrating workflow setup')).toBeVisible();
});

test('keeps a selected workflow reachable when it becomes terminal under the ongoing rail filter', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await page.goto(`/workflows/${scenario.ongoingWorkflow.id}?lifecycle=ongoing`);
  await expect(page).toHaveURL(new RegExp(`/workflows/${scenario.ongoingWorkflow.id}\\?lifecycle=ongoing`));
  await expect(page.locator('h2').filter({ hasText: 'E2E Ongoing Intake' }).first()).toBeVisible();

  await setWorkflowState(scenario.ongoingWorkflow.id, 'completed');
  await page.reload();

  await expect(page).toHaveURL(new RegExp(`/workflows/${scenario.ongoingWorkflow.id}\\?lifecycle=ongoing`));
  await expect(page.locator('h2').filter({ hasText: 'E2E Ongoing Intake' }).first()).toBeVisible();
  await expect(workflowRailButton(page, 'E2E Ongoing Intake')).toBeVisible();
});

test('restores selected work-item details after one transient workspace failure on reload', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await page.goto(
    `/workflows/${scenario.needsActionWorkflow.id}?work_item_id=${scenario.needsActionWorkItem.id}&tab=details`,
  );
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await expect(workbench.getByText('Work item · Prepare blocked release brief')).toBeVisible();
  await expect(workbench.getByText(/what was asked/i)).toBeVisible();

  const workspacePattern = new RegExp(
    `/api/v1/operations/workflows/${scenario.needsActionWorkflow.id}/workspace(?:\\?.*)?$`,
  );
  let failedOnce = false;
  await page.route(workspacePattern, async (route) => {
    if (!failedOnce) {
      failedOnce = true;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            message: 'Temporary restart window',
          },
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.reload();
  await expect(page).toHaveURL(
    new RegExp(
      `/workflows/${scenario.needsActionWorkflow.id}\\?work_item_id=${scenario.needsActionWorkItem.id}&tab=details`,
    ),
  );

  await page.reload();
  await expect(workbench.getByText('Work item · Prepare blocked release brief')).toBeVisible();
  await expect(workbench.getByText(/what was asked/i)).toBeVisible();
});
