import { describe, expect, it } from 'vitest';

import { buildWorkspaceDeliverablesPacket } from '../../../../src/services/workflow-operations/workflow-workspace/workflow-workspace-deliverables.js';
import type { WorkflowDeliverableRecord } from '../../../../src/services/workflow-deliverables/workflow-deliverable-service.js';
import { buildBoard, buildWorkflowScope } from './workflow-workspace-deliverables.test-support.js';

describe('buildWorkspaceDeliverablesPacket rollups', () => {
  it('keeps workflow-scope rollup deliverables final when their source work item is already complete', () => {
    const deliverables = {
      final_deliverables: [
        {
          descriptor_id: 'question-framing-rollup',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Quantum Computing Question Framing',
          state: 'final',
          summary_brief: 'Completed and verified the initial research framing.',
          preview_capabilities: {
            can_inline_preview: true,
            can_download: true,
            can_open_external: false,
            can_copy_path: true,
            preview_kind: 'markdown',
          },
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            path: 'artifact:workflow-1/deliverables/quantum-computing-question-framing.md',
            artifact_id: 'artifact-question-framing',
            url: '/api/v1/tasks/task-question-framing/artifacts/artifact-question-framing/preview',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Completed and verified the initial research framing.\n\nProduced by: Research Analyst',
            source_role_name: 'Research Analyst',
            rollup_source_work_item_id: 'work-item-2',
            rollup_source_descriptor_id: 'question-framing-final',
          },
          source_brief_id: null,
          created_at: '2026-04-04T02:07:43.774Z',
          updated_at: '2026-04-04T02:07:43.774Z',
        } satisfies WorkflowDeliverableRecord,
      ],
      in_progress_deliverables: [],
      working_handoffs: [],
      inputs_and_provenance: {
        launch_packet: null,
        supplemental_packets: [],
        intervention_attachments: [],
        redrive_packet: null,
      },
      next_cursor: null,
      all_deliverables: [],
    };

    const result = buildWorkspaceDeliverablesPacket(
      deliverables as never,
      [],
      'workflow-1',
      buildWorkflowScope() as never,
      buildBoard(),
    );

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'question-framing-rollup',
        delivery_stage: 'final',
        state: 'final',
      }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
  });

  it('downgrades workflow-scope rollup deliverables only when their source work item is still incomplete', () => {
    const deliverables = {
      final_deliverables: [
        {
          descriptor_id: 'source-review-rollup',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Source Review Findings',
          state: 'final',
          summary_brief: 'Completed and verified the source review findings.',
          preview_capabilities: {
            can_inline_preview: true,
            can_download: true,
            can_open_external: false,
            can_copy_path: true,
            preview_kind: 'markdown',
          },
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            path: 'artifact:workflow-1/deliverables/source-review-findings.md',
            artifact_id: 'artifact-source-review',
            url: '/api/v1/tasks/task-source-review/artifacts/artifact-source-review/preview',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Completed and verified the source review findings.\n\nProduced by: Research Analyst',
            source_role_name: 'Research Analyst',
            rollup_source_work_item_id: 'work-item-1',
            rollup_source_descriptor_id: 'source-review-final',
          },
          source_brief_id: null,
          created_at: '2026-04-04T02:17:43.774Z',
          updated_at: '2026-04-04T02:17:43.774Z',
        } satisfies WorkflowDeliverableRecord,
      ],
      in_progress_deliverables: [],
      working_handoffs: [],
      inputs_and_provenance: {
        launch_packet: null,
        supplemental_packets: [],
        intervention_attachments: [],
        redrive_packet: null,
      },
      next_cursor: null,
      all_deliverables: [],
    };

    const result = buildWorkspaceDeliverablesPacket(
      deliverables as never,
      [],
      'workflow-1',
      buildWorkflowScope() as never,
      buildBoard(),
    );

    expect(result.final_deliverables).toEqual([]);
    expect(result.in_progress_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'source-review-rollup',
        delivery_stage: 'in_progress',
        state: 'approved',
      }),
    ]);
  });

  it('keeps workflow-scope rollup deliverables final when terminal work items carry Date completion values', () => {
    const deliverables = {
      final_deliverables: [
        {
          descriptor_id: 'question-framing-rollup',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Quantum Computing Question Framing',
          state: 'final',
          summary_brief: 'Completed and verified the initial research framing.',
          preview_capabilities: {
            can_inline_preview: true,
            can_download: true,
            can_open_external: false,
            can_copy_path: true,
            preview_kind: 'markdown',
          },
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            path: 'artifact:workflow-1/deliverables/quantum-computing-question-framing.md',
            artifact_id: 'artifact-question-framing',
            url: '/api/v1/tasks/task-question-framing/artifacts/artifact-question-framing/preview',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Completed and verified the initial research framing.\n\nProduced by: Research Analyst',
            source_role_name: 'Research Analyst',
            rollup_source_work_item_id: 'work-item-2',
            rollup_source_descriptor_id: 'question-framing-final',
          },
          source_brief_id: null,
          created_at: '2026-04-04T02:07:43.774Z',
          updated_at: '2026-04-04T02:07:43.774Z',
        } satisfies WorkflowDeliverableRecord,
      ],
      in_progress_deliverables: [],
      working_handoffs: [],
      inputs_and_provenance: {
        launch_packet: null,
        supplemental_packets: [],
        intervention_attachments: [],
        redrive_packet: null,
      },
      next_cursor: null,
      all_deliverables: [],
    };
    const board = {
      columns: [
        { id: 'active', is_terminal: false },
        { id: 'done', is_terminal: true },
      ],
      work_items: [
        {
          id: 'work-item-2',
          column_id: 'done',
          completed_at: new Date('2026-04-03T23:31:00.000Z'),
        },
      ],
    };

    const result = buildWorkspaceDeliverablesPacket(
      deliverables as never,
      [],
      'workflow-1',
      buildWorkflowScope() as never,
      board as never,
    );

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'question-framing-rollup',
        delivery_stage: 'final',
        state: 'final',
      }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
  });
});
