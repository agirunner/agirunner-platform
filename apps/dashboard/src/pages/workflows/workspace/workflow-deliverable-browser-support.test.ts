import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowDeliverableRecord } from '../../../lib/api.js';
import { buildBrowserRows } from './workflow-deliverable-browser-support.js';

describe('workflow deliverable browser support', () => {
  it('does not create an inline summary row when a deliverable already has a reference target', () => {
    const rows = buildBrowserRows(
      createDeliverable({
        title: 'Release repository output',
        primary_target: {
          target_kind: 'repository',
          label: 'Release repository output',
          url: 'https://github.com/example/release-audit/pull/42',
          repo_ref: 'release/main',
        },
        content_preview: {
          summary: 'release/main\n\nhttps://github.com/example/release-audit/pull/42',
        },
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.rowKind).toBe('reference');
  });

  it('keeps an explicit inline summary row alongside reference targets', () => {
    const rows = buildBrowserRows(
      createDeliverable({
        title: 'Stakeholder package',
        primary_target: {
          target_kind: 'external_url',
          label: 'Stakeholder package',
          url: 'https://example.com/share/release-audit',
        },
        secondary_targets: [
          {
            target_kind: 'inline_summary',
            label: 'Inline summary',
            url: '',
          },
        ],
        content_preview: {
          text: 'Review notes ready for the operator.',
        },
      }),
    );

    expect(rows.map((row) => row.rowKind)).toEqual(['inline', 'reference']);
  });
});

function createDeliverable(
  overrides: Partial<DashboardWorkflowDeliverableRecord>,
): DashboardWorkflowDeliverableRecord {
  return {
    descriptor_id: 'deliverable-1',
    workflow_id: 'workflow-1',
    work_item_id: null,
    descriptor_kind: 'external_reference',
    delivery_stage: 'in_progress',
    title: 'Deliverable',
    state: 'approved',
    summary_brief: null,
    preview_capabilities: {},
    primary_target: {
      target_kind: '',
      label: '',
      url: '',
    },
    secondary_targets: [],
    content_preview: {},
    source_brief_id: null,
    created_at: '2026-04-03T12:00:00.000Z',
    updated_at: '2026-04-03T12:00:00.000Z',
    ...overrides,
  };
}
