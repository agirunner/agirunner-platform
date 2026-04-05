import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowDeliverableRecord } from '../../../lib/api.js';
import type { DeliverableBrowserRow } from './workflow-deliverable-browser-support.js';
import {
  readDeliverableRowMetadata,
  readDeliverableRowRecordedAt,
  type DeliverableTableRowRecord,
} from './workflow-deliverable-row-display.js';

describe('workflow deliverable row display behavior', () => {
  it('hides internal transport metadata for artifact-backed rows', () => {
    const row = createRow({
      primaryRow: {
        rowKind: 'artifact',
        key: 'artifact:1',
        label: 'finance-workspace-scope-map.md',
        typeLabel: 'Artifact',
        createdAt: '',
        sizeBytes: null,
        canView: true,
        downloadHref: '/api/v1/tasks/task-1/artifacts/artifact-1/download',
        previewHref: '/api/v1/tasks/task-1/artifacts/artifact-1/preview',
        target: {
          target_kind: 'artifact',
          label: 'finance-workspace-scope-map.md',
          url: '/api/v1/tasks/task-1/artifacts/artifact-1/preview',
          path: 'artifact:artifact-1/deliverables/finance-workspace-scope-map.md',
          repo_ref: null,
          artifact_id: 'artifact-1',
          size_bytes: null,
        },
      },
    });

    expect(readDeliverableRowMetadata(row)).toEqual([]);
  });

  it('uses the deliverable lifecycle timestamp before sparse browser-row timestamps', () => {
    const row = createRow({
      deliverable: {
        updated_at: '2026-04-05T00:47:11.000Z',
        created_at: '',
      },
      primaryRow: {
        rowKind: 'inline',
        key: 'inline:1',
        label: 'Inline content',
        typeLabel: 'Inline summary',
        createdAt: '',
        sizeBytes: null,
        canView: true,
        content: 'Preview',
      },
    });

    expect(readDeliverableRowRecordedAt(row)).toBe('2026-04-05T00:47:11.000Z');
  });
});

function createRow(overrides?: {
  deliverable?: Partial<DashboardWorkflowDeliverableRecord>;
  primaryRow?: DeliverableBrowserRow;
}): DeliverableTableRowRecord {
  const deliverable = createDeliverable(overrides?.deliverable);
  return {
    deliverable,
    primaryRow:
      overrides?.primaryRow
      ?? {
        rowKind: 'inline',
        key: 'inline:default',
        label: 'Inline content',
        typeLabel: 'Inline summary',
        createdAt: deliverable.created_at,
        sizeBytes: null,
        canView: true,
        content: 'Preview',
      },
    relatedRows: [],
    sourceBrief: null,
  };
}

function createDeliverable(
  overrides?: Partial<DashboardWorkflowDeliverableRecord>,
): DashboardWorkflowDeliverableRecord {
  return {
    descriptor_id: 'deliverable-1',
    workflow_id: 'workflow-1',
    work_item_id: 'work-item-1',
    descriptor_kind: 'deliverable_packet',
    delivery_stage: 'final',
    title: 'Final Research Synthesis',
    state: 'final',
    summary_brief: null,
    preview_capabilities: {},
    primary_target: {
      target_kind: 'inline_summary',
      label: 'View',
      url: '',
      path: null,
      repo_ref: null,
      artifact_id: null,
      size_bytes: null,
    },
    secondary_targets: [],
    content_preview: {},
    source_brief_id: null,
    created_at: '2026-04-05T00:45:00.000Z',
    updated_at: '2026-04-05T00:45:00.000Z',
    ...overrides,
  };
}
