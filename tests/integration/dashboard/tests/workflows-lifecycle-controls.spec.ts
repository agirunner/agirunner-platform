import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from '../lib/workflows-auth.js';
import { seedWorkflowsScenario } from '../lib/workflows-fixtures.js';

test.use({ viewport: { width: 1280, height: 1100 } });

test('runs workflow pause, resume, and cancel through the top strip and keeps board state coherent', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Ongoing Intake').click();
  const stateStrip = page.locator('[data-workflows-top-strip="true"]');
  const board = page.locator('[data-workflows-board-frame="true"]');

  await stateStrip.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Confirm pause' }).click();
  await expect(page.getByText('Workflow paused', { exact: true }).first()).toBeVisible();
  await expect(stateStrip.getByRole('button', { name: 'Resume' })).toBeVisible();
  await expect(stateStrip.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  await expect(board.getByText('Workflow paused', { exact: true })).toBeVisible();

  await stateStrip.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('Workflow resumed', { exact: true }).first()).toBeVisible();
  await expect(stateStrip.getByRole('button', { name: 'Pause' })).toBeVisible();

  await stateStrip.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Confirm cancel' }).click();
  await expect(page.getByText('Workflow cancellation requested', { exact: true }).first()).toBeVisible();
  await expect(stateStrip.locator('.inline-flex').filter({ hasText: /^Cancelled$/ }).first()).toBeVisible();
  await expect(stateStrip.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  await expect(stateStrip.getByRole('button', { name: 'Resume' })).toHaveCount(0);
  await expect(stateStrip.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
});

test('runs work-item pause, resume, and cancel through local card controls', async ({ page }) => {
  await seedWorkflowsScenario();
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Ongoing Intake').click();
  const board = page.locator('[data-workflows-board-frame="true"]');
  const primaryCard = board.locator('[data-work-item-card="true"]').filter({ hasText: 'Triage intake queue' }).first();
  const secondaryCard = board.locator('[data-work-item-card="true"]').filter({ hasText: 'Triage overflow queue' }).first();

  await primaryCard.locator('[data-work-item-local-control="pause"]').click();
  await expect(primaryCard.locator('.inline-flex').filter({ hasText: /^Paused$/ }).first()).toBeVisible();
  await expect(primaryCard.locator('[data-work-item-local-control="resume"]')).toBeVisible();
  await expect(primaryCard.locator('[data-work-item-local-control="pause"]')).toHaveCount(0);

  await primaryCard.locator('[data-work-item-local-control="resume"]').click();
  await expect(primaryCard.locator('.inline-flex').filter({ hasText: /^Paused$/ }).first()).toHaveCount(0);
  await expect(primaryCard.locator('[data-work-item-local-control="pause"]')).toBeVisible();

  await secondaryCard.locator('[data-work-item-local-control="cancel"]').click();
  const cancelledCard = board.locator('[data-work-item-card="true"]').filter({ hasText: 'Triage overflow queue' }).first();
  await expect(cancelledCard.locator('.inline-flex').filter({ hasText: /^Cancelled$/ }).first()).toBeVisible();
  await expect(cancelledCard.locator('[data-work-item-local-control="cancel"]')).toHaveCount(0);
  await expect(cancelledCard.locator('[data-work-item-local-control="pause"]')).toHaveCount(0);
  await expect(cancelledCard.locator('[data-work-item-local-control="resume"]')).toHaveCount(0);
});
