import { describe, expect, it } from 'vitest';

import { applyWorkspaceStreamBatch } from './workflows-realtime.js';

describe('applyWorkspaceStreamBatch deliverables', () => {
  it('deduplicates workflow-rollup deliverable upserts against the originating work-item artifact', () => {
    const next = applyWorkspaceStreamBatch(
      {
        generated_at: '2026-03-30T12:00:00.000Z',
        latest_event_id: 11,
        snapshot_version: 'workflow-operations:11',
        workflow_id: 'workflow-1',
        workflow: null,
        sticky_strip: null,
        board: { columns: [], work_items: [], active_stages: [], awaiting_gate_count: 0, stage_summary: [] },
        bottom_tabs: {
          current_scope_kind: 'workflow',
          current_work_item_id: null,
          current_task_id: null,
          counts: {
            details: 1,
            needs_action: 0,
            live_console_activity: 0,
            briefs: 0,
            history: 0,
            deliverables: 1,
          },
        },
        needs_action: { items: [], total_count: 0, default_sort: 'priority_desc' },
        steering: { items: [], total_count: 0 },
        live_console: {
          generated_at: '2026-03-30T12:00:00.000Z',
          latest_event_id: 11,
          snapshot_version: 'workflow-operations:11',
          items: [],
          total_count: 0,
          counts: { all: 0, turn_updates: 0, briefs: 0, steering: 0 },
          next_cursor: null,
          live_visibility_mode: 'enhanced',
        },
        briefs: { items: [], total_count: 0, next_cursor: null },
        history: { items: [], groups: [], total_count: 0, next_cursor: null },
        deliverables: {
          inputs_and_provenance: [],
          final_deliverables: [
            {
              descriptor_id: 'deliverable-source',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              descriptor_kind: 'artifact',
              delivery_stage: 'final',
              title: 'Research Framing Brief',
              state: 'final',
              summary_brief: 'Frame the research question.',
              preview_capabilities: { can_inline_preview: true },
              primary_target: {
                target_kind: 'artifact',
                label: 'Open artifact',
                url: '/api/v1/tasks/task-1/artifacts/artifact-1/preview',
                path: 'artifact:workflow-1/research-framing-brief.md',
                artifact_id: 'artifact-1',
              },
              secondary_targets: [],
              content_preview: {
                summary: 'Frame the research question.',
                source_role_name: 'Research Analyst',
              },
              source_brief_id: null,
              created_at: '2026-04-03T23:36:09.131Z',
              updated_at: '2026-04-03T23:36:09.131Z',
            },
          ],
          in_progress_deliverables: [],
          next_cursor: null,
          total_count: 1,
        },
        redrive_lineage: null,
      } as never,
      {
        generated_at: '2026-03-30T12:01:00.000Z',
        latest_event_id: 12,
        snapshot_version: 'workflow-operations:12',
        cursor: 'workflow-operations:12',
        events: [
          {
            event_type: 'deliverable_upsert',
            cursor: 'workflow-operations:12',
            snapshot_version: 'workflow-operations:12',
            workflow_id: 'workflow-1',
            payload: {
              descriptor_id: 'deliverable-rollup',
              workflow_id: 'workflow-1',
              work_item_id: null,
              descriptor_kind: 'deliverable_packet',
              delivery_stage: 'final',
              title: 'Final Research Synthesis Audit Export Workflow',
              state: 'final',
              summary_brief: 'Workflow rollup replay of the same artifact.',
              preview_capabilities: { can_inline_preview: true },
              primary_target: {
                target_kind: 'artifact',
                label: 'Open artifact',
                url: '/api/v1/tasks/task-1/artifacts/artifact-1/preview',
                path: 'artifact:workflow-1/research-framing-brief.md',
                artifact_id: 'artifact-1',
              },
              secondary_targets: [],
              content_preview: {
                summary: 'Workflow rollup replay of the same artifact.',
                source_role_name: 'Research Analyst',
                rollup_source_work_item_id: 'work-item-1',
              },
              source_brief_id: null,
              created_at: '2026-04-03T23:37:09.131Z',
              updated_at: '2026-04-03T23:37:09.131Z',
            },
          },
        ],
      },
    );

    expect(next).toBeDefined();
    if (!next) {
      throw new Error('expected workspace packet');
    }
    expect(next.deliverables.final_deliverables).toHaveLength(1);
    expect(next.deliverables.final_deliverables[0]).toEqual(
      expect.objectContaining({
        title: 'Research Framing Brief',
        descriptor_id: 'deliverable-source',
      }),
    );
  });

  it('keeps the newest inline summary when an older summary upsert replays into the same work-item scope', () => {
    const next = applyWorkspaceStreamBatch(
      {
        generated_at: '2026-03-30T12:00:00.000Z',
        latest_event_id: 11,
        snapshot_version: 'workflow-operations:11',
        workflow_id: 'workflow-1',
        workflow: null,
        sticky_strip: null,
        board: { columns: [], work_items: [], active_stages: [], awaiting_gate_count: 0, stage_summary: [] },
        bottom_tabs: {
          current_scope_kind: 'selected_work_item',
          current_work_item_id: 'work-item-1',
          current_task_id: null,
          counts: {
            details: 1,
            needs_action: 0,
            live_console_activity: 0,
            briefs: 0,
            history: 0,
            deliverables: 1,
          },
        },
        needs_action: { items: [], total_count: 0, default_sort: 'priority_desc' },
        steering: { items: [], total_count: 0 },
        live_console: {
          generated_at: '2026-03-30T12:00:00.000Z',
          latest_event_id: 11,
          snapshot_version: 'workflow-operations:11',
          items: [],
          total_count: 0,
          counts: { all: 0, turn_updates: 0, briefs: 0, steering: 0 },
          next_cursor: null,
          live_visibility_mode: 'enhanced',
        },
        briefs: { items: [], total_count: 0, next_cursor: null },
        history: { items: [], groups: [], total_count: 0, next_cursor: null },
        deliverables: {
          inputs_and_provenance: [],
          final_deliverables: [],
          in_progress_deliverables: [
            {
              descriptor_id: 'inline-summary-current',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              descriptor_kind: 'inline_summary',
              delivery_stage: 'in_progress',
              title: 'Inline decision summary',
              state: 'approved',
              summary_brief: 'Latest inline summary.',
              preview_capabilities: { can_inline_preview: true },
              primary_target: {
                target_kind: 'inline_summary',
                label: 'Inline decision summary',
                url: '',
              },
              secondary_targets: [],
              content_preview: {
                text: 'Final analysis:\nThe release can proceed because the rollback note is captured.',
              },
              source_brief_id: null,
              created_at: '2026-04-03T13:07:05.000Z',
              updated_at: '2026-04-03T13:07:05.000Z',
            },
          ],
          next_cursor: null,
          total_count: 1,
        },
        redrive_lineage: null,
      } as never,
      {
        generated_at: '2026-03-30T12:01:00.000Z',
        latest_event_id: 12,
        snapshot_version: 'workflow-operations:12',
        cursor: 'workflow-operations:12',
        events: [
          {
            event_type: 'deliverable_upsert',
            cursor: 'workflow-operations:12',
            snapshot_version: 'workflow-operations:12',
            workflow_id: 'workflow-1',
            payload: {
              descriptor_id: 'inline-summary-older',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              descriptor_kind: 'inline_summary',
              delivery_stage: 'in_progress',
              title: 'Inline decision summary',
              state: 'approved',
              summary_brief: 'Older inline summary.',
              preview_capabilities: { can_inline_preview: true },
              primary_target: {
                target_kind: 'inline_summary',
                label: 'Inline decision summary',
                url: '',
              },
              secondary_targets: [],
              content_preview: {
                text: 'Previous analysis:\nInitial framing note before the final revision.',
              },
              source_brief_id: null,
              created_at: '2026-03-31T00:05:26.000Z',
              updated_at: '2026-03-31T00:05:26.000Z',
            },
          },
        ],
      },
    );

    expect(next).toBeDefined();
    if (!next) {
      throw new Error('expected workspace packet');
    }
    expect(next.deliverables.in_progress_deliverables).toHaveLength(1);
    expect(next.deliverables.in_progress_deliverables[0]).toEqual(
      expect.objectContaining({
        descriptor_id: 'inline-summary-current',
      }),
    );
  });

  it('keeps an interim deliverable visible when a final artifact for the same logical file arrives later', () => {
    const next = applyWorkspaceStreamBatch(
      {
        generated_at: '2026-03-30T12:00:00.000Z',
        latest_event_id: 11,
        snapshot_version: 'workflow-operations:11',
        workflow_id: 'workflow-1',
        workflow: null,
        sticky_strip: null,
        board: { columns: [], work_items: [], active_stages: [], awaiting_gate_count: 0, stage_summary: [] },
        bottom_tabs: {
          current_scope_kind: 'selected_work_item',
          current_work_item_id: 'work-item-1',
          current_task_id: null,
          counts: {
            details: 1,
            needs_action: 0,
            live_console_activity: 0,
            briefs: 0,
            history: 0,
            deliverables: 1,
          },
        },
        needs_action: { items: [], total_count: 0, default_sort: 'priority_desc' },
        steering: { items: [], total_count: 0 },
        live_console: {
          generated_at: '2026-03-30T12:00:00.000Z',
          latest_event_id: 11,
          snapshot_version: 'workflow-operations:11',
          items: [],
          total_count: 0,
          counts: { all: 0, turn_updates: 0, briefs: 0, steering: 0 },
          next_cursor: null,
          live_visibility_mode: 'enhanced',
        },
        briefs: { items: [], total_count: 0, next_cursor: null },
        history: { items: [], groups: [], total_count: 0, next_cursor: null },
        deliverables: {
          inputs_and_provenance: [],
          final_deliverables: [],
          in_progress_deliverables: [
            {
              descriptor_id: 'scope-map-interim',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              descriptor_kind: 'inline_summary',
              delivery_stage: 'in_progress',
              title: 'Initial scope map',
              state: 'approved',
              summary_brief: 'Initial scope framing.',
              preview_capabilities: { can_inline_preview: true },
              primary_target: {
                target_kind: 'inline_summary',
                label: 'finance-workspace-scope-map.md',
                url: '',
                path: 'deliverables/finance-workspace-scope-map.md',
              },
              secondary_targets: [],
              content_preview: {
                summary: 'Path: deliverables/finance-workspace-scope-map.md',
              },
              source_brief_id: 'brief-1',
              created_at: '2026-04-04T18:52:00.229Z',
              updated_at: '2026-04-04T18:52:00.229Z',
            },
          ],
          next_cursor: null,
          total_count: 1,
        },
        redrive_lineage: null,
      } as never,
      {
        generated_at: '2026-03-30T12:01:00.000Z',
        latest_event_id: 12,
        snapshot_version: 'workflow-operations:12',
        cursor: 'workflow-operations:12',
        events: [
          {
            event_type: 'deliverable_upsert',
            cursor: 'workflow-operations:12',
            snapshot_version: 'workflow-operations:12',
            workflow_id: 'workflow-1',
            payload: {
              descriptor_id: 'scope-map-final',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              descriptor_kind: 'deliverable_packet',
              delivery_stage: 'final',
              title: 'Map review scope for finance workspace access review and audit export handling completion packet',
              state: 'final',
              summary_brief: 'Final scoped packet.',
              preview_capabilities: { can_inline_preview: true },
              primary_target: {
                target_kind: 'artifact',
                label: 'Open artifact',
                url: '/api/v1/tasks/task-1/artifacts/artifact-1/preview',
                path: 'artifact:workflow-1/deliverables/finance-workspace-scope-map.md',
                artifact_id: 'artifact-1',
              },
              secondary_targets: [],
              content_preview: {
                summary: 'Final scoped packet.',
                source_role_name: 'Policy Analyst',
              },
              source_brief_id: null,
              created_at: '2026-04-04T18:58:00.229Z',
              updated_at: '2026-04-04T18:58:00.229Z',
            },
          },
        ],
      },
    );

    expect(next).toBeDefined();
    if (!next) {
      throw new Error('expected workspace packet');
    }
    expect(next.deliverables.in_progress_deliverables).toHaveLength(1);
    expect(next.deliverables.in_progress_deliverables[0]).toEqual(
      expect.objectContaining({
        descriptor_id: 'scope-map-interim',
      }),
    );
    expect(next.deliverables.final_deliverables).toHaveLength(1);
    expect(next.deliverables.final_deliverables[0]).toEqual(
      expect.objectContaining({
        descriptor_id: 'scope-map-final',
      }),
    );
  });
});
