import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from '../lib/workflows-auth.js';
import { routeDeliverablesWorkspace } from '../lib/workflows-deliverables-routing.js';
import { seedWorkflowDeliverablesScenario } from '../lib/workflows-deliverables-fixtures.js';

test.use({ viewport: { width: 1280, height: 1100 } });

test('renders a flat deliverables table with one row per deliverable and direct row actions', async ({ page }) => {
  await seedWorkflowDeliverablesScenario();
  await routeDeliverablesWorkspace(page, 'E2E Needs Action Delivery');
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await workbench.getByRole('tab', { name: 'Deliverables' }).click();

  await expect(workbench.getByText('Showing all deliverables recorded across this workflow')).toBeVisible();
  await expect(workbench.getByText('Working handoffs')).toHaveCount(0);
  const deliverablesTable = workbench.getByRole('table').first();

  const architectureDeliverableRow = deliverablesTable
    .getByRole('row', { name: /Architecture bundle/ })
    .first();
  const repositoryDeliverableRow = deliverablesTable
    .getByRole('row', { name: /Release repository output.*Repository/ })
    .first();
  const packetDeliverableRow = deliverablesTable
    .getByRole('row', { name: /Signed workflow packet.*Workflow document/ })
    .first();
  const shareDeliverableRow = deliverablesTable
    .getByRole('row', { name: /Stakeholder share link.*External URL/ })
    .first();
  const exportDeliverableRow = deliverablesTable
    .getByRole('row', { name: /Export directory.*Host directory/ })
    .first();
  const inlineDeliverableRow = deliverablesTable
    .getByRole('row', { name: /Inline decision summary/ })
    .first();

  await expect(architectureDeliverableRow).toBeVisible();
  await expect(repositoryDeliverableRow).toBeVisible();
  await expect(packetDeliverableRow).toBeVisible();
  await expect(shareDeliverableRow).toBeVisible();
  await expect(exportDeliverableRow).toBeVisible();
  await expect(inlineDeliverableRow).toBeVisible();
  await expect(deliverablesTable.getByRole('row', { name: /Policy handoff note/ })).toHaveCount(0);
  await expect(deliverablesTable.getByRole('row', { name: /Architecture bundle/ })).toHaveCount(1);
  await expect(architectureDeliverableRow).toContainText('architecture-brief.md');
  await expect(architectureDeliverableRow).toContainText('release-checklist.json');

  await expect(architectureDeliverableRow).toContainText('Interim');
  await expect(repositoryDeliverableRow).toContainText('Final');
  await expect(packetDeliverableRow).toContainText('Interim');
  await expect(shareDeliverableRow).toContainText('Interim');
  await expect(exportDeliverableRow).toContainText('Interim');
  await expect(inlineDeliverableRow).toContainText('Interim');
  await expect(repositoryDeliverableRow).toContainText('release/main');
  await expect(repositoryDeliverableRow).toContainText('https://github.com/example/release-audit/pull/42');
  await expect(shareDeliverableRow).toContainText('https://example.com/share/release-audit');
  await expect(exportDeliverableRow).toContainText('/var/tmp/exports/release-audit');

  await architectureDeliverableRow.scrollIntoViewIfNeeded();
  await expect(architectureDeliverableRow.getByRole('button', { name: 'Download' })).toBeVisible();
  await expect(architectureDeliverableRow.getByRole('button', { name: 'View' })).toBeVisible();
  await expect(workbench.getByText('Unknown time')).toHaveCount(0);
  await expect(workbench.getByText('This packet captures the release architecture.')).toHaveCount(0);
  await expect(workbench.getByText('Structured host directory output for downstream export tools.')).toHaveCount(0);
  await expect(
    workbench.getByText('Completed the reproduce-stage investigation and posted a handoff note'),
  ).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await architectureDeliverableRow.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('architecture-brief.md');

  await architectureDeliverableRow.getByRole('button', { name: 'View' }).click();
  await expect(workbench.getByRole('table')).toHaveCount(1);
  await expect(workbench.getByText('Architecture brief')).toBeVisible();
  await expect(workbench.getByText('This packet captures the release architecture.')).toBeVisible();
  await architectureDeliverableRow.getByRole('button', { name: 'Hide' }).click();
  await expect(workbench.getByText('Architecture brief')).toHaveCount(0);

  await repositoryDeliverableRow.scrollIntoViewIfNeeded();
  await expect(repositoryDeliverableRow.getByRole('button', { name: 'View' })).toHaveCount(0);
  await expect(repositoryDeliverableRow.getByRole('link', { name: 'Open' })).toHaveAttribute(
    'href',
    'https://github.com/example/release-audit/pull/42',
  );

  await packetDeliverableRow.scrollIntoViewIfNeeded();
  await expect(packetDeliverableRow.getByRole('button', { name: 'View' })).toHaveCount(0);
  await expect(packetDeliverableRow.getByRole('link', { name: 'Open' })).toHaveAttribute(
    'href',
    'https://docs.example.com/workflows/release-packet',
  );

  await shareDeliverableRow.scrollIntoViewIfNeeded();
  await expect(shareDeliverableRow.getByRole('button', { name: 'View' })).toHaveCount(0);
  await expect(shareDeliverableRow.getByRole('link', { name: 'Open' })).toHaveAttribute(
    'href',
    'https://example.com/share/release-audit',
  );

  await exportDeliverableRow.scrollIntoViewIfNeeded();
  await expect(exportDeliverableRow.getByRole('button', { name: 'View' })).toHaveCount(0);
  await expect(exportDeliverableRow.getByRole('link', { name: 'Open' })).toHaveCount(0);

  await inlineDeliverableRow.scrollIntoViewIfNeeded();
  await inlineDeliverableRow.getByRole('button', { name: 'View' }).click();
  const inlinePreviewCard = workbench
    .locator('[data-workflow-deliverable-preview-card="true"]')
    .filter({ hasText: 'Final analysis:' })
    .first();
  await expect(inlinePreviewCard).toContainText('Final analysis:');
  await expect(inlinePreviewCard).toContainText('rollback note is captured');
  await expect(inlinePreviewCard).not.toContainText('Produced by:');
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
  const deliverablesTable = workbench.getByRole('table').first();
  await expect(
    deliverablesTable.getByRole('row', { name: /Architecture bundle/ }).first(),
  ).toBeVisible();
  await expect(deliverablesTable.getByRole('row', { name: /Architecture bundle/ })).toHaveCount(1);
  await expect(deliverablesTable.getByRole('row', { name: /Signed workflow packet/ }).first()).toBeVisible();
  await expect(deliverablesTable.getByRole('row', { name: /Export directory/ }).first()).toBeVisible();
  await expect(deliverablesTable.getByRole('row', { name: /Inline decision summary/ })).toBeVisible();
  await expect(deliverablesTable.getByRole('row', { name: /Release repository output/ })).toHaveCount(0);
  await expect(deliverablesTable.getByRole('row', { name: /Stakeholder share link/ })).toHaveCount(0);
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
  const deliverablesPanel = page.locator('[data-workflows-deliverables-scroll-region="true"]').first();

  const deliverablesTable = workbench.getByRole('table').first();
  const architectureDeliverableRow = deliverablesTable
    .getByRole('row', { name: /Architecture bundle/ })
    .first();
  await expect(workbench.getByText('This packet captures the release architecture.')).toHaveCount(0);
  expect(
    await deliverablesPanel.evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true);
  await deliverablesPanel.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await deliverablesPanel.evaluate((element) => element.scrollTop > 0)).toBe(true);

  await architectureDeliverableRow.scrollIntoViewIfNeeded();
  await expect(architectureDeliverableRow).toContainText('release-audit-100.txt');
  await architectureDeliverableRow.getByRole('button', { name: 'View' }).click();
  await expect(workbench.getByText('Architecture brief')).toBeVisible();

  const inlineDeliverableRow = deliverablesTable.getByRole('row', { name: /Inline decision summary/ }).first();
  await inlineDeliverableRow.scrollIntoViewIfNeeded();
  await inlineDeliverableRow.getByRole('button', { name: 'View' }).click();
  await expect(workbench.getByText('Paragraph 80: keep the release packet, supporting evidence, and approval package aligned before final publication.')).toBeVisible();
  await expect(workbench.getByText('Tail marker: INLINE-END')).toBeVisible();
});

test('keeps a single table visible while inline previews open below the selected row', async ({ page }) => {
  await seedWorkflowDeliverablesScenario();
  await routeDeliverablesWorkspace(page, 'E2E Needs Action Delivery');
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await workbench.getByRole('tab', { name: 'Deliverables' }).click();

  await expect(workbench.getByRole('table')).toHaveCount(1);
  const deliverablesTable = workbench.getByRole('table').first();
  const architectureDeliverableRow = deliverablesTable
    .getByRole('row', { name: /Architecture bundle/ })
    .first();

  await architectureDeliverableRow.getByRole('button', { name: 'View' }).click();
  await expect(workbench.getByRole('table')).toHaveCount(1);
  await expect(workbench.getByText('Architecture brief')).toBeVisible();
});
