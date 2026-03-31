import { Buffer } from 'node:buffer';
import { expect, type Page, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from './support/workflows-auth.js';
import { seedWorkflowDeliverablesScenario } from './support/workflows-deliverables-fixtures.js';

test.use({ viewport: { width: 1280, height: 1100 } });

test('renders supported deliverable types and artifact actions at workflow scope', async ({ page }) => {
  await seedWorkflowDeliverablesScenario();
  await loginToWorkflows(page);
  await routeDeliverablesWorkspace(page, 'E2E Needs Action Delivery');

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await workbench.getByRole('button', { name: 'Deliverables' }).click();

  await expect(workbench.getByText('Showing all deliverables recorded across this workflow')).toBeVisible();
  await expect(workbench.getByText('Architecture bundle')).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Release repository output' })).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Signed workflow packet' })).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Stakeholder share link' })).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Export directory' })).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Inline decision summary' })).toBeVisible();
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
  await loginToWorkflows(page);
  await routeDeliverablesWorkspace(page, 'E2E Needs Action Delivery');

  await workflowRailButton(page, 'E2E Needs Action Delivery').click();
  await page.getByRole('button', { name: 'Prepare blocked release brief' }).click();
  const workbench = page.locator('[data-workflows-workbench-frame="true"]');
  await workbench.getByRole('button', { name: 'Deliverables' }).click();

  await expect(workbench.getByText('Showing only deliverables recorded for Prepare blocked release brief.')).toBeVisible();
  await expect(workbench.getByText('Architecture bundle')).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Signed workflow packet' })).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Export directory' })).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Inline decision summary' })).toBeVisible();

  await expect(workbench.getByRole('button', { name: 'Release repository output' })).toHaveCount(0);
  await expect(workbench.getByRole('button', { name: 'Stakeholder share link' })).toHaveCount(0);
});

interface RoutedArtifactRecord {
  id: string;
  taskId: string;
  fileName: string;
  logicalPath: string;
  contentType: string;
  contentText: string;
  sizeBytes: number;
}

async function routeDeliverablesWorkspace(page: Page, workflowName: string): Promise<void> {
  const artifactCatalog = new Map<string, RoutedArtifactRecord[]>();

  await page.route(/\/api\/v1\/operations\/workflows\/[^/]+\/workspace(?:\?.*)?$/, async (route) => {
    const requestUrl = new URL(route.request().url());
    const response = await route.fetch();
    const payload = await response.json() as { data?: Record<string, unknown> } & Record<string, unknown>;
    const packet = (payload.data ?? payload) as Record<string, unknown>;
    const stickyStrip = asRecord(packet.sticky_strip);
    if ((stickyStrip.workflow_name as string | undefined) !== workflowName) {
      await route.fulfill({ response, json: payload });
      return;
    }

    const patchedArtifacts = patchDeliverablesPayload(packet);
    for (const [taskId, artifacts] of patchedArtifacts.entries()) {
      artifactCatalog.set(taskId, artifacts);
    }

    await route.fulfill({ response, json: payload });
  });

  await page.route(/\/api\/v1\/tasks\/[^/]+\/artifacts(?:\?.*)?$/, async (route) => {
    const taskId = route.request().url().match(/\/api\/v1\/tasks\/([^/]+)\/artifacts/)?.[1] ?? null;
    if (!taskId || !artifactCatalog.has(taskId)) {
      await route.fallback();
      return;
    }
    const artifacts = artifactCatalog.get(taskId) ?? [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: artifacts.map((artifact) => ({
          id: artifact.id,
          task_id: artifact.taskId,
          logical_path: artifact.logicalPath,
          content_type: artifact.contentType,
          size_bytes: artifact.sizeBytes,
          created_at: '2026-03-31T11:05:26.441Z',
        })),
      }),
    });
  });

  await page.route(/\/api\/v1\/tasks\/[^/]+\/artifacts\/[^/?]+(?:\?.*)?$/, async (route) => {
    const match = route.request().url().match(/\/api\/v1\/tasks\/([^/]+)\/artifacts\/([^/?]+)/);
    const taskId = match?.[1] ?? null;
    const artifactId = match?.[2] ?? null;
    if (!taskId || !artifactId) {
      await route.fallback();
      return;
    }
    const artifacts = artifactCatalog.get(taskId) ?? [];
    const artifact = artifacts.find((entry) => entry.id === artifactId);
    if (!artifact) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: artifact.contentType,
      headers: {
        'content-type': artifact.contentType,
        'content-length': String(artifact.sizeBytes),
        'content-disposition': `attachment; filename="${artifact.fileName}"`,
      },
      body: artifact.contentText,
    });
  });
}

function patchDeliverablesPayload(packet: Record<string, unknown>): Map<string, RoutedArtifactRecord[]> {
  const deliverables = asRecord(packet.deliverables);
  const finalDeliverables = asArray(deliverables.final_deliverables);
  const inProgressDeliverables = asArray(deliverables.in_progress_deliverables);
  const allDeliverables = asArray(deliverables.all_deliverables);
  const architectureDeliverable = [...finalDeliverables, ...inProgressDeliverables, ...allDeliverables].find(
    (entry) => asRecord(entry).title === 'Architecture bundle',
  );
  const signedPacketDeliverable = [...finalDeliverables, ...inProgressDeliverables, ...allDeliverables].find(
    (entry) => asRecord(entry).title === 'Signed workflow packet',
  );
  const artifactCatalog = new Map<string, RoutedArtifactRecord[]>();

  if (architectureDeliverable) {
    const artifactRows = buildArtifactCatalogEntry(asRecord(architectureDeliverable));
    if (artifactRows.length > 0) {
      artifactCatalog.set(artifactRows[0]!.taskId, artifactRows);
    }
  }

  const workItemId = architectureDeliverable ? readOptionalString(asRecord(architectureDeliverable).work_item_id) : null;
  const workflowId = readOptionalString(packet.workflow_id);
  const createdAtBase = '2026-03-31T07:05:26.640Z';
  const missingInProgressDeliverables = [
    buildHostDirectoryDeliverable(workflowId, workItemId, createdAtBase),
    buildInlineSummaryDeliverable(workflowId, workItemId, createdAtBase),
  ];

  for (const deliverable of missingInProgressDeliverables) {
    if (
      !containsDeliverable(finalDeliverables, deliverable.descriptor_id)
      && !containsDeliverable(inProgressDeliverables, deliverable.descriptor_id)
      && !containsDeliverable(allDeliverables, deliverable.descriptor_id)
      && !containsEquivalentDeliverable(finalDeliverables, deliverable)
      && !containsEquivalentDeliverable(inProgressDeliverables, deliverable)
      && !containsEquivalentDeliverable(allDeliverables, deliverable)
    ) {
      inProgressDeliverables.push(deliverable);
      allDeliverables.push(deliverable);
    }
  }

  deliverables.final_deliverables = finalDeliverables;
  deliverables.in_progress_deliverables = sortDeliverablesByRecency(inProgressDeliverables);
  deliverables.all_deliverables = sortDeliverablesByRecency([
    ...finalDeliverables,
    ...inProgressDeliverables,
  ]);

  const bottomTabs = asRecord(packet.bottom_tabs);
  const counts = asRecord(bottomTabs.counts);
  counts.deliverables = finalDeliverables.length + inProgressDeliverables.length;

  if (signedPacketDeliverable) {
    const signedPacket = asRecord(signedPacketDeliverable);
    if (!containsDeliverable(allDeliverables, String(signedPacket.descriptor_id))) {
      allDeliverables.push(signedPacket);
    }
  }

  return artifactCatalog;
}

function buildArtifactCatalogEntry(deliverable: Record<string, unknown>): RoutedArtifactRecord[] {
  const targets = [asRecord(deliverable.primary_target), ...asArray(deliverable.secondary_targets).map(asRecord)];
  const records: RoutedArtifactRecord[] = [];

  for (const target of targets) {
    if (readOptionalString(target.target_kind) !== 'artifact') {
      continue;
    }
    const previewUrl = readOptionalString(target.url) ?? '';
    const match = previewUrl.match(/\/api\/v1\/tasks\/([^/]+)\/artifacts\/([^/?]+)/);
    const taskId = match?.[1] ?? null;
    const artifactId = readOptionalString(target.artifact_id) ?? match?.[2] ?? null;
    const fileName = readOptionalString(target.label) ?? 'artifact.bin';
    const logicalPath = readOptionalString(target.path) ?? fileName;
    if (!taskId || !artifactId) {
      continue;
    }
    const contentText = fileName.endsWith('.md')
      ? '# Architecture brief\n\nThis packet captures the release architecture.'
      : '{\n  "ready": true,\n  "owner": "release"\n}';
    const contentType = fileName.endsWith('.md') ? 'text/markdown' : 'application/json';
    records.push({
      id: artifactId,
      taskId,
      fileName,
      logicalPath,
      contentType,
      contentText,
      sizeBytes: Buffer.byteLength(contentText, 'utf8'),
    });
  }

  return records;
}

function buildHostDirectoryDeliverable(
  workflowId: string | null,
  workItemId: string | null,
  createdAt: string,
): Record<string, unknown> {
  return {
    descriptor_id: 'seeded-host-directory',
    workflow_id: workflowId,
    work_item_id: workItemId,
    descriptor_kind: 'host_directory_export',
    delivery_stage: 'in_progress',
    title: 'Export directory',
    state: 'approved',
    summary_brief: 'Structured host directory output for downstream export tools.',
    preview_capabilities: {
      can_inline_preview: false,
      can_download: false,
    },
    primary_target: {
      target_kind: 'host_directory',
      label: 'Export directory',
      url: '',
      path: '/var/tmp/exports/release-audit',
    },
    secondary_targets: [],
    content_preview: {
      summary: '/var/tmp/exports/release-audit',
    },
    source_brief_id: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function buildInlineSummaryDeliverable(
  workflowId: string | null,
  workItemId: string | null,
  createdAt: string,
): Record<string, unknown> {
  return {
    descriptor_id: 'seeded-inline-summary',
    workflow_id: workflowId,
    work_item_id: workItemId,
    descriptor_kind: 'inline_summary',
    delivery_stage: 'in_progress',
    title: 'Inline decision summary',
    state: 'approved',
    summary_brief: 'Inline summary only; no external artifact is attached.',
    preview_capabilities: {
      can_inline_preview: true,
      can_download: false,
    },
    primary_target: {
      target_kind: 'inline_summary',
      label: 'Inline decision summary',
      url: '',
    },
    secondary_targets: [],
    content_preview: {
      text: 'Operator summary:\n- rollback note added\n- release checklist verified\n- ready for final approval',
    },
    source_brief_id: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function sortDeliverablesByRecency(
  deliverables: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return [...deliverables].sort((left, right) => {
    const leftUpdatedAt = readOptionalString(left.updated_at) ?? readOptionalString(left.created_at) ?? '';
    const rightUpdatedAt = readOptionalString(right.updated_at) ?? readOptionalString(right.created_at) ?? '';
    return rightUpdatedAt.localeCompare(leftUpdatedAt);
  });
}

function containsDeliverable(
  deliverables: Array<Record<string, unknown>>,
  descriptorId: string,
): boolean {
  return deliverables.some((entry) => readOptionalString(entry.descriptor_id) === descriptorId);
}

function containsEquivalentDeliverable(
  deliverables: Array<Record<string, unknown>>,
  deliverable: Record<string, unknown>,
): boolean {
  const title = readOptionalString(deliverable.title);
  const descriptorKind = readOptionalString(deliverable.descriptor_kind);
  return deliverables.some((entry) =>
    readOptionalString(entry.title) === title
    && readOptionalString(entry.descriptor_kind) === descriptorKind,
  );
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
