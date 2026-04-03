import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from '../lib/workflows-auth.js';
import { routeDeliverablesWorkspace } from '../lib/workflows-deliverables-routing.js';
import { seedWorkflowDeliverablesScenario } from '../lib/workflows-deliverables-fixtures.js';

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
  const deliverablesTable = workbench.getByRole('table').first();

  const architectureDeliverableRow = deliverablesTable.getByRole('row', { name: /Architecture bundle/ }).first();
  const repositoryDeliverableRow = deliverablesTable.getByRole('row', { name: /Release repository output/ }).first();
  const packetDeliverableRow = deliverablesTable.getByRole('row', { name: /Signed workflow packet/ }).first();
  const shareDeliverableRow = deliverablesTable.getByRole('row', { name: /Stakeholder share link/ }).first();
  const exportDeliverableRow = deliverablesTable.getByRole('row', { name: /Export directory/ }).first();
  const inlineDeliverableRow = deliverablesTable.getByRole('row', { name: /Inline decision summary/ }).first();

  await expect(architectureDeliverableRow).toBeVisible();
  await expect(repositoryDeliverableRow).toBeVisible();
  await expect(packetDeliverableRow).toBeVisible();
  await expect(shareDeliverableRow).toBeVisible();
  await expect(exportDeliverableRow).toBeVisible();
  await expect(inlineDeliverableRow).toBeVisible();

  await architectureDeliverableRow.scrollIntoViewIfNeeded();
  await architectureDeliverableRow.getByRole('button', { name: 'Open' }).click();
  const browserTable = workbench.getByRole('table').nth(1);
  const architectureRow = browserTable.getByRole('row', { name: /architecture-brief\.md/ }).first();
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

  await repositoryDeliverableRow.scrollIntoViewIfNeeded();
  await repositoryDeliverableRow.getByRole('button', { name: 'Open' }).click();
  await workbench.getByRole('button', { name: 'Release repository output' }).last().click();
  await expect(workbench.getByText('release/main')).toBeVisible();
  await expect(workbench.getByRole('link', { name: 'Open target' })).toHaveAttribute(
    'href',
    'https://github.com/example/release-audit/pull/42',
  );

  await packetDeliverableRow.scrollIntoViewIfNeeded();
  await packetDeliverableRow.getByRole('button', { name: 'Open' }).click();
  await workbench.getByRole('button', { name: 'Signed workflow packet' }).last().click();
  await expect(workbench.getByText('Path')).toBeVisible();
  await expect(workbench.getByText('release-packet', { exact: true })).toBeVisible();

  await shareDeliverableRow.scrollIntoViewIfNeeded();
  await shareDeliverableRow.getByRole('button', { name: 'Open' }).click();
  await workbench.getByRole('button', { name: 'Stakeholder share link' }).last().click();
  await expect(workbench.getByText('Canonical target')).toBeVisible();
  await expect(workbench.getByRole('link', { name: 'Open target' })).toHaveAttribute(
    'href',
    'https://example.com/share/release-audit',
  );

  await exportDeliverableRow.scrollIntoViewIfNeeded();
  await exportDeliverableRow.getByRole('button', { name: 'Open' }).click();
  await workbench.getByRole('button', { name: 'Export directory' }).last().click();
  await expect(workbench.getByText('Path')).toBeVisible();
  await expect(workbench.getByText('/var/tmp/exports/release-audit')).toBeVisible();

  await inlineDeliverableRow.scrollIntoViewIfNeeded();
  await inlineDeliverableRow.getByRole('button', { name: 'Open' }).click();
  await workbench.getByRole('button', { name: 'Inline decision summary' }).last().click();
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
  await expect(workbench.getByText('Working handoffs')).toHaveCount(0);
  const deliverablesTable = workbench.getByRole('table').first();
  await expect(deliverablesTable.getByRole('row', { name: /Architecture bundle/ })).toBeVisible();
  await expect(deliverablesTable.getByRole('row', { name: /Signed workflow packet/ })).toBeVisible();
  await expect(deliverablesTable.getByRole('row', { name: /Export directory/ })).toBeVisible();
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

  const deliverablesTable = workbench.getByRole('table').first();
  const architectureDeliverableRow = deliverablesTable.getByRole('row', { name: /Architecture bundle/ }).first();
  await architectureDeliverableRow.getByRole('button', { name: 'Open' }).click();
  const browserTable = workbench.getByRole('table').nth(1);
  await expect(workbench.getByText('This packet captures the release architecture.')).toHaveCount(0);

  const oversizedRow = browserTable.getByRole('row', { name: /release-audit-100\.txt/ }).first();
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

  const inlineDeliverableRow = deliverablesTable.getByRole('row', { name: /Inline decision summary/ }).first();
  await inlineDeliverableRow.scrollIntoViewIfNeeded();
  await inlineDeliverableRow.getByRole('button', { name: 'Open' }).click();
  await workbench.getByRole('button', { name: 'Inline decision summary' }).last().click();
  await expect(workbench.getByText('operator checkpoint 80')).toBeVisible();
  await expect(workbench.getByText('Tail marker: INLINE-END')).toBeVisible();
});

test('renders a single deliverables table before opening the selected row browser', async ({ page }) => {
  await seedWorkflowDeliverablesScenario();
  await routeDeliverablesWorkspace(page, 'E2E Needs Action Delivery');
  await loginToWorkflows(page);

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await workbench.getByRole('tab', { name: 'Deliverables' }).click();

  await expect(workbench.getByRole('table')).toHaveCount(1);
  const deliverablesTable = workbench.getByRole('table').first();
  await deliverablesTable.getByRole('row', { name: /Architecture bundle/ }).getByRole('button', { name: 'Open' }).click();
  await expect(workbench.getByRole('table')).toHaveCount(2);
});
