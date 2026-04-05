import { describe, expect, it } from 'vitest';

import type { MissionControlOutputDescriptor } from '../../../../src/services/workflow-operations/mission-control/types.js';
import { buildWorkspaceDeliverablesPacket } from '../../../../src/services/workflow-operations/workflow-workspace/workflow-workspace-deliverables.js';
import type { WorkflowDeliverableRecord } from '../../../../src/services/workflow-deliverables/workflow-deliverable-service.js';
import { buildBoard, buildWorkflowScope } from './workflow-workspace-deliverables.test-support.js';

describe('buildWorkspaceDeliverablesPacket merging', () => {
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

  it('replaces packet wrappers with a real artifact row when the workflow card already exposes the same content artifact', () => {
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
        descriptor_id: 'output:artifact-2',
        descriptor_kind: 'artifact',
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

  it('fills sparse live artifact rows with the fallback title, recorded time, and specialist', () => {
    const deliverables = {
      final_deliverables: [
        {
          descriptor_id: 'deliverable-live-artifact',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'artifact',
          delivery_stage: 'final',
          title: 'artifact:workflow-1/deliverables/final-research-synthesis-quantum-computer.md',
          state: 'final',
          summary_brief: null,
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
            path: 'artifact:workflow-1/deliverables/final-research-synthesis-quantum-computer.md',
            artifact_id: 'artifact-final',
            url: '/api/v1/tasks/task-final/artifacts/artifact-final/preview',
          },
          secondary_targets: [],
          content_preview: {},
          source_brief_id: null,
          created_at: '',
          updated_at: '',
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
        id: 'artifact-final',
        title: 'artifact:workflow-1/deliverables/final-research-synthesis-quantum-computer.md',
        summary: null,
        status: 'final',
        recordedAt: '2026-04-04T23:31:48.398Z',
        producedByRole: 'Research Analyst',
        workItemId: 'work-item-1',
        taskId: 'task-final',
        stageName: 'synthesis',
        primaryLocation: {
          kind: 'artifact',
          artifactId: 'artifact-final',
          taskId: 'task-final',
          logicalPath: 'artifact:workflow-1/deliverables/final-research-synthesis-quantum-computer.md',
          previewPath: '/api/v1/tasks/task-final/artifacts/artifact-final/preview',
          downloadPath: '/api/v1/tasks/task-final/artifacts/artifact-final',
          contentType: 'text/markdown',
          sizeBytes: 512,
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
        descriptor_id: 'deliverable-live-artifact',
        title: 'Final Research Synthesis Quantum Computer',
        created_at: '2026-04-04T23:31:48.398Z',
        updated_at: '2026-04-04T23:31:48.398Z',
        content_preview: expect.objectContaining({
          source_role_name: 'Research Analyst',
        }),
      }),
    ]);
  });

  it('merges repository-backed workflow documents onto the synthesized repo reference row', () => {
    const deliverables = {
      final_deliverables: [
        {
          descriptor_id: 'workflow-document:merge_readiness_review',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'workflow_document',
          delivery_stage: 'final',
          title: 'Export Stabilization Merge-Readiness Review',
          state: 'final',
          summary_brief: 'Repository-backed review document.',
          preview_capabilities: {
            can_inline_preview: false,
            can_download: false,
            can_open_external: false,
            can_copy_path: true,
            preview_kind: 'structured_summary',
          },
          primary_target: {
            target_kind: 'repo_reference',
            label: 'Export Stabilization Merge-Readiness Review',
            url: '',
            path: 'docs/reviews/export-stabilization-merge-readiness.md',
            repo_ref: 'origin/main:docs/reviews/export-stabilization-merge-readiness.md',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Repository-backed review document.',
          },
          source_brief_id: null,
          created_at: '',
          updated_at: '',
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
        id: 'document-1',
        title: 'Export Stabilization Merge-Readiness Review',
        summary: 'Repository-backed review document.',
        status: 'approved',
        recordedAt: '2026-04-05T20:49:22.717Z',
        producedByRole: 'Code Reviewer',
        workItemId: 'work-item-1',
        taskId: 'task-review-1',
        stageName: 'review',
        primaryLocation: {
          kind: 'workflow_document',
          workflowId: 'workflow-1',
          documentId: 'document-1',
          logicalName: 'merge_readiness_review',
          source: 'repository',
          location: 'docs/reviews/export-stabilization-merge-readiness.md',
          artifactId: null,
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
        descriptor_id: 'workflow-document:merge_readiness_review',
        title: 'Export Stabilization Merge-Readiness Review',
        created_at: '2026-04-05T20:49:22.717Z',
        updated_at: '2026-04-05T20:49:22.717Z',
        primary_target: expect.objectContaining({
          target_kind: 'repo_reference',
          path: 'docs/reviews/export-stabilization-merge-readiness.md',
          repo_ref: 'origin/main:docs/reviews/export-stabilization-merge-readiness.md',
          url: '',
        }),
        content_preview: expect.objectContaining({
          source_role_name: 'Code Reviewer',
        }),
      }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
  });

  it('presents a packet-backed artifact as content even when no fallback descriptor is available', () => {
    const deliverables = {
      final_deliverables: [
        {
          descriptor_id: 'deliverable-question-framing',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Research Framing Brief',
          state: 'final',
          summary_brief: 'Completed and verified the initial framing brief.',
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
            artifact_id: 'artifact-question-framing',
            url: '/api/v1/tasks/task-question-framing/artifacts/artifact-question-framing/preview',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Completed and verified the initial framing brief.',
            source_role_name: 'Research Analyst',
          },
          source_brief_id: null,
          created_at: '2026-04-04T03:12:00.000Z',
          updated_at: '2026-04-04T03:12:00.000Z',
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
        descriptor_id: 'deliverable-question-framing',
        descriptor_kind: 'artifact',
        title: 'Research Framing Brief',
        primary_target: expect.objectContaining({
          target_kind: 'artifact',
          artifact_id: 'artifact-question-framing',
        }),
      }),
    ]);
  });

  it('preserves visible timestamps when fallback artifact metadata is sparse', () => {
    const deliverables = {
      final_deliverables: [
        {
          descriptor_id: 'deliverable-final-synthesis',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Quantum Computer Final Synthesis',
          state: 'final',
          summary_brief: 'Synthesized the gathered evidence into a final explainer.',
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
            path: 'artifact:workflow-1/quantum-computer-final-synthesis.md',
            artifact_id: 'artifact-final-synthesis',
            url: '/api/v1/tasks/task-final-synthesis/artifacts/artifact-final-synthesis/preview',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Synthesized the gathered evidence into a final explainer.',
            source_role_name: 'Research Analyst',
          },
          source_brief_id: null,
          created_at: '2026-04-04T08:15:00.000Z',
          updated_at: '2026-04-04T08:15:00.000Z',
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
        id: 'artifact-final-synthesis',
        title: 'artifact:workflow-1/quantum-computer-final-synthesis.md',
        summary: null,
        status: 'final',
        recordedAt: null,
        producedByRole: null,
        workItemId: 'work-item-1',
        taskId: 'task-final-synthesis',
        stageName: 'synthesis',
        primaryLocation: {
          kind: 'artifact',
          artifactId: 'artifact-final-synthesis',
          taskId: 'task-final-synthesis',
          logicalPath: 'artifact:workflow-1/quantum-computer-final-synthesis.md',
          previewPath:
            '/api/v1/tasks/task-final-synthesis/artifacts/artifact-final-synthesis/preview',
          downloadPath: '/api/v1/tasks/task-final-synthesis/artifacts/artifact-final-synthesis',
          contentType: 'text/markdown',
          sizeBytes: 512,
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
        title: 'Quantum Computer Final Synthesis',
        created_at: '2026-04-04T08:15:00.000Z',
        updated_at: '2026-04-04T08:15:00.000Z',
      }),
    ]);
  });

  it('humanizes fallback-only artifact titles and keeps recorded metadata when no visible row exists yet', () => {
    const deliverables = {
      final_deliverables: [],
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
        id: 'artifact-final-synthesis',
        title: 'artifact:workflow-1/quantum-computer-final-synthesis.md',
        summary: 'Final research synthesis.',
        status: 'final',
        recordedAt: '2026-04-04T08:20:00.000Z',
        producedByRole: 'Research Analyst',
        workItemId: null,
        taskId: 'task-final-synthesis',
        stageName: 'synthesis',
        primaryLocation: {
          kind: 'artifact',
          artifactId: 'artifact-final-synthesis',
          taskId: 'task-final-synthesis',
          logicalPath: 'artifact:workflow-1/quantum-computer-final-synthesis.md',
          previewPath:
            '/api/v1/tasks/task-final-synthesis/artifacts/artifact-final-synthesis/preview',
          downloadPath: '/api/v1/tasks/task-final-synthesis/artifacts/artifact-final-synthesis',
          contentType: 'text/markdown',
          sizeBytes: 512,
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
        title: 'Quantum Computer Final Synthesis',
        created_at: '2026-04-04T08:20:00.000Z',
        updated_at: '2026-04-04T08:20:00.000Z',
        content_preview: expect.objectContaining({
          source_role_name: 'Research Analyst',
        }),
      }),
    ]);
  });

  it('prefers a richer artifact-backed title over a later generic packet title for the same deliverable identity', () => {
    const deliverables = {
      final_deliverables: [
        {
          descriptor_id: 'deliverable-final-summary',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Final synthesis deliverable',
          state: 'final',
          summary_brief: 'Path: deliverables/quantum-computer-final-synthesis.md',
          preview_capabilities: {
            can_inline_preview: true,
            can_download: false,
            can_open_external: false,
            can_copy_path: true,
            preview_kind: 'structured_summary',
          },
          primary_target: {
            target_kind: 'inline_summary',
            label: 'Final synthesis deliverable',
            path: 'deliverables/quantum-computer-final-synthesis.md',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Path: deliverables/quantum-computer-final-synthesis.md',
          },
          source_brief_id: null,
          created_at: '2026-04-04T08:25:00.000Z',
          updated_at: '2026-04-04T08:25:00.000Z',
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
        id: 'artifact-final-synthesis',
        title: 'artifact:workflow-1/deliverables/quantum-computer-final-synthesis.md',
        summary: 'Completed the final synthesis with source grounding and quality notes.',
        status: 'final',
        recordedAt: '2026-04-04T08:24:00.000Z',
        producedByRole: 'Research Analyst',
        workItemId: 'work-item-1',
        taskId: 'task-final-synthesis',
        stageName: 'synthesis',
        primaryLocation: {
          kind: 'artifact',
          artifactId: 'artifact-final-synthesis',
          taskId: 'task-final-synthesis',
          logicalPath: 'artifact:workflow-1/deliverables/quantum-computer-final-synthesis.md',
          previewPath:
            '/api/v1/tasks/task-final-synthesis/artifacts/artifact-final-synthesis/preview',
          downloadPath: '/api/v1/tasks/task-final-synthesis/artifacts/artifact-final-synthesis',
          contentType: 'text/markdown',
          sizeBytes: 512,
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
        title: 'Quantum Computer Final Synthesis',
        created_at: '2026-04-04T08:25:00.000Z',
        updated_at: '2026-04-04T08:25:00.000Z',
        content_preview: expect.objectContaining({
          source_role_name: 'Research Analyst',
        }),
        primary_target: expect.objectContaining({
          target_kind: 'artifact',
          artifact_id: 'artifact-final-synthesis',
        }),
      }),
    ]);
  });
});
