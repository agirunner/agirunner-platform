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
  it('does not duplicate artifact-backed deliverables when a canonical packet already points at the same artifact', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'done', is_terminal: true }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'Package release',
            stage_name: 'release',
            column_id: 'done',
            blocked_state: null,
            blocked_reason: null,
            escalation_status: null,
            gate_status: null,
            task_count: 1,
            children_count: 0,
            completed_at: '2026-03-28T05:00:00.000Z',
          },
        ],
        stage_summary: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'waiting_by_design',
        pulse: { summary: 'Release output published' },
        outputDescriptors: [
          {
            id: 'artifact:matching',
            title: 'artifact:workflow/release-packet.md',
            summary: 'Release packet draft',
            status: 'final',
            producedByRole: null,
            workItemId: 'work-item-1',
            taskId: 'task-1',
            stageName: 'release',
            primaryLocation: {
              kind: 'artifact',
              artifactId: 'artifact-1',
              taskId: 'task-1',
              logicalPath: 'artifact:workflow/release-packet.md',
              previewPath: '/artifacts/tasks/task-1/artifact-1',
              downloadPath: '/api/v1/tasks/task-1/artifacts/artifact-1',
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
          activeTaskCount: 0,
          activeWorkItemCount: 0,
          lastChangedAt: '2026-03-28T05:00:00.000Z',
        },
      })),
    };
    const liveConsoleService = {
      getLiveConsole: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:140',
        generated_at: '2026-03-28T05:00:00.000Z',
        latest_event_id: 140,
        items: [],
        next_cursor: null,
        live_visibility_mode: 'enhanced',
      })),
    };
    const historyService = {
      getHistory: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:140',
        generated_at: '2026-03-28T05:00:00.000Z',
        latest_event_id: 140,
        groups: [],
        items: [],
        filters: { available: [], active: [] },
        next_cursor: null,
      })),
    };
    const deliverablesService = {
      getDeliverables: vi.fn(async () => ({
        final_deliverables: [
          {
            descriptor_id: 'descriptor-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'handoff_packet',
            delivery_stage: 'final',
            title: 'Package release completion packet',
            state: 'final',
            summary_brief: 'Canonical packet',
            preview_capabilities: {
              can_inline_preview: true,
              can_download: true,
            },
            primary_target: {
              target_kind: 'artifact',
              artifact_id: 'artifact-1',
              path: 'artifact:workflow/release-packet.md',
              url: '/artifacts/tasks/task-1/artifact-1',
            },
            secondary_targets: [],
            content_preview: {},
            source_brief_id: null,
            created_at: '2026-03-28T05:00:00.000Z',
            updated_at: '2026-03-28T05:00:00.000Z',
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
            descriptor_id: 'descriptor-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'handoff_packet',
            delivery_stage: 'final',
            title: 'Package release completion packet',
            state: 'final',
            summary_brief: 'Canonical packet',
            preview_capabilities: {
              can_inline_preview: true,
              can_download: true,
            },
            primary_target: {
              target_kind: 'artifact',
              artifact_id: 'artifact-1',
              path: 'artifact:workflow/release-packet.md',
              url: '/artifacts/tasks/task-1/artifact-1',
            },
            secondary_targets: [],
            content_preview: {},
            source_brief_id: null,
            created_at: '2026-03-28T05:00:00.000Z',
            updated_at: '2026-03-28T05:00:00.000Z',
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
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_work_item',
      workItemId: 'work-item-1',
    });

    expect(result.deliverables.final_deliverables).toHaveLength(1);
    expect(result.deliverables.final_deliverables[0]).toEqual(
      expect.objectContaining({
        descriptor_kind: 'artifact',
        title: 'Package release completion packet',
        primary_target: expect.objectContaining({
          artifact_id: 'artifact-1',
        }),
      }),
    );
  });

});
