import { describe, expect, it, vi } from 'vitest';

import { WorkflowWorkspaceService } from '../../../../src/services/workflow-operations/workflow-workspace-service.js';

const briefsService = {
  getBriefs: vi.fn(async () => ({
    snapshot_version: 'workflow-operations:120',
    generated_at: '2026-03-27T22:45:00.000Z',
    latest_event_id: 120,
    items: [],
    total_count: 0,
    next_cursor: null,
  })),
};

describe('WorkflowWorkspaceService', () => {
  it('keeps rolled-up work-item deliverables visible while still synthesizing a missing workflow fallback deliverable', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'active', is_terminal: false }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'Package release',
            stage_name: 'release',
            column_id: 'active',
            blocked_state: null,
            blocked_reason: null,
            escalation_status: null,
            gate_status: null,
            task_count: 1,
            children_count: 0,
            completed_at: null,
          },
        ],
        stage_summary: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'progressing',
        pulse: { summary: 'Shipping outputs' },
        outputDescriptors: [
          {
            id: 'artifact:workflow-summary',
            title: 'artifact:workflow/program-status.md',
            summary: 'Workflow status brief',
            status: 'draft',
            producedByRole: null,
            workItemId: null,
            taskId: 'task-99',
            stageName: 'workflow',
            primaryLocation: {
              kind: 'artifact',
              artifactId: 'artifact-99',
              taskId: 'task-99',
              logicalPath: 'artifact:workflow/program-status.md',
              previewPath: '/artifacts/tasks/task-99/artifact-99',
              downloadPath: '/api/v1/tasks/task-99/artifacts/artifact-99',
              contentType: 'text/markdown',
            },
            secondaryLocations: [],
          },
        ],
        availableActions: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 0,
          activeTaskCount: 1,
          activeWorkItemCount: 1,
          lastChangedAt: '2026-03-27T22:45:00.000Z',
        },
      })),
    };
    const liveConsoleService = {
      getLiveConsole: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        items: [],
        total_count: 0,
        next_cursor: null,
        live_visibility_mode: 'enhanced',
      })),
    };
    const historyService = {
      getHistory: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        groups: [],
        items: [],
        total_count: 0,
        filters: { available: [], active: [] },
        next_cursor: null,
      })),
    };
    const deliverablesService = {
      getDeliverables: vi.fn(async () => ({
        final_deliverables: [
          {
            descriptor_id: 'deliverable-work-item-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Release checklist',
            state: 'final',
            summary_brief: 'Release checklist is complete.',
            preview_capabilities: {},
            primary_target: {
              target_kind: 'inline_summary',
              label: 'Review packet',
            },
            secondary_targets: [],
            content_preview: {
              summary: 'Release checklist is complete.',
            },
            source_brief_id: null,
            created_at: '2026-03-29T18:44:23.277Z',
            updated_at: '2026-03-29T18:44:23.277Z',
          },
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
        all_deliverables: [
          {
            descriptor_id: 'deliverable-work-item-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Release checklist',
            state: 'final',
            summary_brief: 'Release checklist is complete.',
            preview_capabilities: {},
            primary_target: {
              target_kind: 'inline_summary',
              label: 'Review packet',
            },
            secondary_targets: [],
            content_preview: {
              summary: 'Release checklist is complete.',
            },
            source_brief_id: null,
            created_at: '2026-03-29T18:44:23.277Z',
            updated_at: '2026-03-29T18:44:23.277Z',
          },
        ],
      })),
    };
    const interventionService = {
      listWorkflowInterventions: vi.fn(async () => []),
    };
    const steeringSessionService = {
      listSessions: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
    };

    const service = new WorkflowWorkspaceService(
      workflowService as never,
      railService as never,
      liveConsoleService as never,
      historyService as never,
      deliverablesService as never,
      interventionService as never,
      steeringSessionService as never,
      undefined,
      undefined,
      briefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.deliverables.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-work-item-1',
        work_item_id: 'work-item-1',
      }),
    ]);
    expect(result.deliverables.in_progress_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'output:artifact:workflow-summary',
        work_item_id: null,
        title: 'artifact:workflow/program-status.md',
      }),
    ]);
    expect(result.bottom_tabs.counts.deliverables).toBe(2);
  });

});
