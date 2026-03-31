import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import { seedWorkflowsScenario } from './support/workflows-fixtures.js';

test('restores workflow scope, selected work item, and tab state across refresh and live console', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.getByRole('button', { name: 'Prepare blocked release brief' }).click();
  await expect(page).toHaveURL(/workflows\/.+\?work_item_id=.*tab=details/);
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await expect(workbench.getByText('Work item · Prepare blocked release brief')).toBeVisible();
  await expect(workbench.getByText('What was asked')).toBeVisible();

  await page.reload();
  await expect(workbench.getByText('Work item · Prepare blocked release brief')).toBeVisible();
  await expect(workbench.getByText('What was asked')).toBeVisible();

  await page.getByRole('button', { name: 'Live Console' }).click();
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

test('humanizes orchestrator-only in-flight workflows in the rail and workspace header', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  const row = page.getByRole('button', { name: /E2E Orchestrator Setup/ }).first();
  await expect(row).toContainText('Orchestrator working');
  await row.click();

  const stateStrip = page.locator('[data-workflows-top-strip="true"]');
  await expect(stateStrip.getByText('Orchestrating workflow setup')).toBeVisible();
});
