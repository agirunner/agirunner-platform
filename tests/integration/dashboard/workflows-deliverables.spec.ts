import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import { routeDeliverablesWorkspace } from './support/workflows-deliverables-routing.js';
import { seedWorkflowDeliverablesScenario } from './support/workflows-deliverables-fixtures.js';

test.use({ viewport: { width: 1280, height: 1100 } });

test('renders supported deliverable types and artifact actions at workflow scope', async ({ page }) => {
  await seedWorkflowDeliverablesScenario();
  await routeDeliverablesWorkspace(page, 'E2E Needs Action Delivery');
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await workbench.getByRole('tab', { name: 'Deliverables' }).click();

  await expect(workbench.getByText('Showing all deliverables recorded across this workflow')).toBeVisible();
  await expect(workbench.getByText('Architecture bundle')).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Release repository output' }).first()).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Signed workflow packet' }).first()).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Stakeholder share link' }).first()).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Export directory' }).first()).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Inline decision summary' }).first()).toBeVisible();
  await expect(workbench.getByText('Workflow document').first()).toBeVisible();
  await expect(workbench.getByText('Repository').first()).toBeVisible();
  await expect(workbench.getByText('External URL').first()).toBeVisible();
  await expect(workbench.getByText('Host directory').first()).toBeVisible();
  await expect(workbench.getByText('Inline summary').first()).toBeVisible();

  const architectureRow = workbench.locator('tr').filter({ hasText: 'architecture-brief.md' }).first();
  await expect(architectureRow).toContainText('68 B');
  await expect(architectureRow.getByRole('button', { name: 'Download' })).toBeVisible();
  await expect(workbench.locator('tr').filter({ hasText: 'release-checklist.json' }).first()).toContainText('41 B');

  const downloadPromise = page.waitForEvent('download');
  await architectureRow.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('architecture-brief.md');

  await architectureRow.getByRole('button', { name: 'Preview' }).click();
  await expect(workbench.getByText('Architecture brief')).toBeVisible();
  await expect(workbench.getByText('This packet captures the release architecture.')).toBeVisible();

  await workbench.getByRole('button', { name: 'Release repository output' }).click();
  await expect(workbench.getByText('release/main')).toBeVisible();
  await expect(workbench.getByRole('link', { name: 'Open target' })).toHaveAttribute(
    'href',
    'https://github.com/example/release-audit/pull/42',
  );

  await workbench.getByRole('button', { name: 'Inline decision summary' }).click();
  await expect(workbench.getByText('Operator summary:')).toBeVisible();
  await expect(workbench.getByText('rollback note added')).toBeVisible();
});

test('narrows deliverables to the selected work item and keeps workflow-only rows out of scope', async ({ page }) => {
  await seedWorkflowDeliverablesScenario();
  await routeDeliverablesWorkspace(page, 'E2E Needs Action Delivery');
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.getByRole('button', { name: 'Prepare blocked release brief' }).click();
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await workbench.getByRole('tab', { name: 'Deliverables' }).click();

  await expect(workbench.getByText('Showing only deliverables recorded for Prepare blocked release brief.')).toBeVisible();
  await expect(workbench.getByText('Architecture bundle')).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Signed workflow packet' }).first()).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Export directory' }).first()).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Inline decision summary' }).first()).toBeVisible();

  await expect(workbench.getByRole('button', { name: 'Release repository output' })).toHaveCount(0);
  await expect(workbench.getByRole('button', { name: 'Stakeholder share link' })).toHaveCount(0);
});

test('keeps large deliverable payloads usable across artifact catalogs and inline summaries', async ({ page }) => {
  const scenario = await seedWorkflowDeliverablesScenario();
  await routeDeliverablesWorkspace(page, 'E2E Needs Action Delivery', {
    artifactCount: 100,
    inlineSummaryRepeatCount: 80,
  });
  await loginToWorkflows(page);

  await page.goto(`/workflows/${scenario.needsActionWorkflow.id}`);
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await workbench.getByRole('tab', { name: 'Deliverables' }).click();

  const architectureCard = workbench.locator('article').filter({ hasText: 'Architecture bundle' }).first();
  await expect(architectureCard.getByRole('button', { name: 'Download' })).toHaveCount(100);

  const oversizedRow = architectureCard.locator('tr').filter({ hasText: 'release-audit-100.txt' }).first();
  await oversizedRow.scrollIntoViewIfNeeded();
  await expect(oversizedRow).toContainText('700.0 KB');
  await oversizedRow.getByRole('button', { name: 'Preview' }).click();

  const previewLimitNotice = workbench.getByText(
    /Inline preview is limited to .*Download this file to inspect the full payload\./,
  );
  await previewLimitNotice.scrollIntoViewIfNeeded();
  await expect(previewLimitNotice).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await oversizedRow.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('release-audit-100.txt');

  const inlineCard = workbench.locator('article').filter({ hasText: 'Inline decision summary' }).first();
  await inlineCard.getByRole('button', { name: 'Read' }).click();
  await expect(inlineCard.getByText('operator checkpoint 80')).toBeVisible();
  await expect(inlineCard.getByText('Tail marker: INLINE-END')).toBeVisible();
});
