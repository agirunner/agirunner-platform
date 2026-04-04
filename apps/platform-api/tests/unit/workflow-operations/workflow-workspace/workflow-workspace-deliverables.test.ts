import { describe, expect, it } from 'vitest';

import { buildWorkspaceDeliverablesPacket } from '../../../../src/services/workflow-operations/workflow-workspace/workflow-workspace-deliverables.js';
import type { MissionControlOutputDescriptor } from '../../../../src/services/workflow-operations/mission-control/types.js';
import type { WorkflowDeliverableRecord } from '../../../../src/services/workflow-deliverables/workflow-deliverable-service.js';

function buildWorkflowScope() {
  return {
    scope_kind: 'workflow',
    workflow_id: 'workflow-1',
    work_item_id: null,
    task_id: null,
  } as const;
}

function buildBoard() {
  return {
    columns: [
      { id: 'active', is_terminal: false },
      { id: 'done', is_terminal: true },
    ],
    work_items: [
      {
        id: 'work-item-1',
        column_id: 'active',
        completed_at: null,
      },
      {
        id: 'work-item-2',
        column_id: 'done',
        completed_at: '2026-04-03T23:31:00.000Z',
      },
    ],
  };
}

describe('buildWorkspaceDeliverablesPacket', () => {
  it('overlays a concrete artifact target onto a visible inline-summary placeholder for the same logical file', () => {
    const deliverables = {
      final_deliverables: [
        {
          descriptor_id: 'placeholder-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Source review artifact',
          state: 'final',
          summary_brief: null,
          preview_capabilities: {
            can_inline_preview: true,
            can_download: false,
            can_open_external: false,
            can_copy_path: true,
            preview_kind: 'structured_summary',
          },
          primary_target: {
            target_kind: 'inline_summary',
            label: 'Source review artifact',
            path: 'source-review-audit-export-workflow.md',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Path: source-review-audit-export-workflow.md',
          },
          source_brief_id: 'brief-1',
          created_at: '2026-04-03T23:33:08.504Z',
          updated_at: '2026-04-03T23:33:08.504Z',
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
    const outputDescriptors: MissionControlOutputDescriptor[] = [
      {
        id: 'artifact-1',
        title: 'artifact:workflow-1/source-review-audit-export-workflow.md',
        summary: null,
        status: 'draft',
        producedByRole: 'Research Analyst',
        workItemId: 'work-item-1',
        taskId: 'task-1',
        stageName: 'research',
        primaryLocation: {
          kind: 'artifact',
          artifactId: 'artifact-1',
          taskId: 'task-1',
          logicalPath: 'artifact:workflow-1/source-review-audit-export-workflow.md',
          previewPath: '/api/v1/tasks/task-1/artifacts/artifact-1/preview',
          downloadPath: '/api/v1/tasks/task-1/artifacts/artifact-1',
          contentType: 'text/markdown',
          sizeBytes: 128,
        },
        secondaryLocations: [],
      },
    ];

    const result = buildWorkspaceDeliverablesPacket(
      deliverables as never,
      outputDescriptors,
      'workflow-1',
      buildWorkflowScope() as never,
      buildBoard(),
    );

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'output:artifact-1',
        title: 'Source review artifact',
        content_preview: expect.objectContaining({
          source_role_name: 'Research Analyst',
        }),
        primary_target: expect.objectContaining({
          target_kind: 'artifact',
          path: 'artifact:workflow-1/source-review-audit-export-workflow.md',
          artifact_id: 'artifact-1',
        }),
      }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
    expect(result.all_deliverables).toEqual(result.final_deliverables);
  });

  it('suppresses a fallback artifact row when a concrete deliverable already covers the same logical file', () => {
    const deliverables = {
      final_deliverables: [
        {
          descriptor_id: 'deliverable-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Research Framing Brief',
          state: 'final',
          summary_brief: 'Delivered a verified research framing brief.',
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
            path: 'artifact:workflow-1/research-framing-brief.md',
            artifact_id: 'artifact-2',
            url: '/api/v1/tasks/task-2/artifacts/artifact-2/preview',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Delivered a verified research framing brief.',
          },
          source_brief_id: null,
          created_at: '2026-04-03T23:30:54.605Z',
          updated_at: '2026-04-03T23:30:54.605Z',
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
    const outputDescriptors: MissionControlOutputDescriptor[] = [
      {
        id: 'artifact-2',
        title: 'artifact:workflow-1/research-framing-brief.md',
        summary: null,
        status: 'draft',
        producedByRole: 'Research Analyst',
        workItemId: 'work-item-1',
        taskId: 'task-2',
        stageName: 'research',
        primaryLocation: {
          kind: 'artifact',
          artifactId: 'artifact-2',
          taskId: 'task-2',
          logicalPath: 'artifact:workflow-1/research-framing-brief.md',
          previewPath: '/api/v1/tasks/task-2/artifacts/artifact-2/preview',
          downloadPath: '/api/v1/tasks/task-2/artifacts/artifact-2',
          contentType: 'text/markdown',
          sizeBytes: 256,
        },
        secondaryLocations: [],
      },
    ];

    const result = buildWorkspaceDeliverablesPacket(
      deliverables as never,
      outputDescriptors,
      'workflow-1',
      buildWorkflowScope() as never,
      buildBoard(),
    );

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-1',
        title: 'Research Framing Brief',
        content_preview: expect.objectContaining({
          source_role_name: 'Research Analyst',
        }),
        primary_target: expect.objectContaining({
          target_kind: 'artifact',
          artifact_id: 'artifact-2',
        }),
      }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
  });

  it('downgrades workflow-scope rollup deliverables while the workflow still has incomplete work items', () => {
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

    expect(result.final_deliverables).toEqual([]);
    expect(result.in_progress_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'question-framing-rollup',
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
