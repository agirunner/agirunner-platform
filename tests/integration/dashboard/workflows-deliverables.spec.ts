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
  await expect(workbench.getByText('Working handoffs')).toHaveCount(0);
  await expect(workbench.getByText('Architecture bundle')).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Release repository output' }).first()).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Signed workflow packet' }).first()).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Stakeholder share link' }).first()).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Export directory' }).first()).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Inline decision summary' }).first()).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Inline decision summary' })).toHaveCount(1);
  await expect(workbench.getByText('Workflow document').first()).toBeVisible();
  await expect(workbench.getByText('Repository').first()).toBeVisible();
  await expect(workbench.getByText('External URL').first()).toBeVisible();
  await expect(workbench.getByText('Host directory').first()).toBeVisible();
  await expect(workbench.getByText('Inline summary').first()).toBeVisible();

  const architectureCard = workbench.locator('article').filter({ hasText: 'Architecture bundle' }).first();
  const repositoryCard = workbench.locator('article').filter({ hasText: 'Release repository output' }).first();
  const packetCard = workbench.locator('article').filter({ hasText: 'Signed workflow packet' }).first();
  const shareCard = workbench.locator('article').filter({ hasText: 'Stakeholder share link' }).first();
  const exportCard = workbench.locator('article').filter({ hasText: 'Export directory' }).first();
  const inlineCard = workbench.locator('article').filter({ hasText: 'Inline decision summary' }).first();

  const architectureRow = architectureCard.locator('tr').filter({ hasText: 'architecture-brief.md' }).first();
  await expect(architectureRow.getByRole('button', { name: 'Download' })).toBeVisible();
  await expect(workbench.getByText('Unknown time')).toHaveCount(0);
  await expect(workbench.getByText('This packet captures the release architecture.')).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await architectureRow.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('architecture-brief.md');

  await architectureRow.getByRole('button', { name: 'View' }).click();
  await expect(workbench.getByText('Architecture brief')).toBeVisible();
  await expect(workbench.getByText('This packet captures the release architecture.')).toBeVisible();
  await architectureRow.getByRole('button', { name: 'Hide' }).click();
  await expect(workbench.getByText('Architecture brief')).toHaveCount(0);

  await repositoryCard.getByRole('button', { name: 'Release repository output' }).click();
  await expect(repositoryCard.getByText('release/main')).toBeVisible();
  await expect(repositoryCard.getByRole('link', { name: 'Open target' })).toHaveAttribute(
    'href',
    'https://github.com/example/release-audit/pull/42',
  );

  await packetCard.getByRole('button', { name: 'Signed workflow packet' }).click();
  await expect(packetCard.getByText('Path')).toBeVisible();
  await expect(packetCard.getByText('release-packet', { exact: true })).toBeVisible();

  await shareCard.getByRole('button', { name: 'Stakeholder share link' }).click();
  await expect(shareCard.getByText('Canonical target')).toBeVisible();
  await expect(shareCard.getByRole('link', { name: 'Open target' })).toHaveAttribute(
    'href',
    'https://example.com/share/release-audit',
  );

  await exportCard.getByRole('button', { name: 'Export directory' }).click();
  await expect(exportCard.getByText('Path')).toBeVisible();
  await expect(exportCard.getByText('/var/tmp/exports/release-audit')).toBeVisible();

  await inlineCard.getByRole('button', { name: 'Inline decision summary' }).click();
  await expect(inlineCard.getByText('Operator summary:')).toBeVisible();
  await expect(inlineCard.getByText('rollback note added')).toBeVisible();
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
  await expect(workbench.getByText('Working handoffs')).toHaveCount(0);
  await expect(workbench.getByText('Architecture bundle')).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Signed workflow packet' }).first()).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Export directory' }).first()).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Inline decision summary' }).first()).toBeVisible();

  await expect(workbench.getByRole('button', { name: 'Release repository output' })).toHaveCount(0);
  await expect(workbench.getByRole('button', { name: 'Stakeholder share link' })).toHaveCount(0);
});

test('keeps large deliverable payloads usable across artifact catalogs and inline summaries', async ({ page }) => {
  await seedWorkflowDeliverablesScenario();
  await routeDeliverablesWorkspace(page, 'E2E Needs Action Delivery', {
    artifactCount: 100,
    inlineSummaryRepeatCount: 80,
  });
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await workbench.getByRole('tab', { name: 'Deliverables' }).click();

  const architectureCard = workbench.locator('article').filter({ hasText: 'Architecture bundle' }).first();
  await expect(workbench.getByText('This packet captures the release architecture.')).toHaveCount(0);

  const oversizedRow = architectureCard.locator('tr').filter({ hasText: 'release-audit-100.txt' }).first();
  await oversizedRow.scrollIntoViewIfNeeded();
  await oversizedRow.getByRole('button', { name: 'View' }).click();

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
  await inlineCard.getByRole('button', { name: 'View' }).click();
  await expect(inlineCard.getByText('operator checkpoint 80')).toBeVisible();
  await expect(inlineCard.getByText('Tail marker: INLINE-END')).toBeVisible();
});

test('keeps deliverable browser columns aligned across final and interim rows', async ({ page }) => {
  await seedWorkflowDeliverablesScenario();
  await routeDeliverablesWorkspace(page, 'E2E Needs Action Delivery');
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await workbench.getByRole('tab', { name: 'Deliverables' }).click();

  const finalCard = workbench.locator('article').filter({ hasText: 'Architecture bundle' }).first();
  const interimCard = workbench.locator('article').filter({ hasText: 'Export directory' }).first();

  const finalHeaderMetrics = await finalCard.locator('th').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        right: Math.round(box.right),
      };
    }),
  );
  const interimHeaderMetrics = await interimCard.locator('th').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        right: Math.round(box.right),
      };
    }),
  );

  expect(finalHeaderMetrics).toHaveLength(4);
  expect(interimHeaderMetrics).toHaveLength(4);

  for (let index = 0; index < finalHeaderMetrics.length; index += 1) {
    expect(Math.abs(finalHeaderMetrics[index]!.left - interimHeaderMetrics[index]!.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(finalHeaderMetrics[index]!.right - interimHeaderMetrics[index]!.right)).toBeLessThanOrEqual(1);
  }
});
