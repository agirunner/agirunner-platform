import { describe, expect, it, vi } from 'vitest';

import { WorkflowWorkspaceService } from '../../../src/services/workflow-operations/workflow-workspace-service.js';

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
  it('keeps workflow-scoped deliverables visible in selected work-item scope before falling back to output descriptors', async () => {
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
            id: 'artifact:matching',
            title: 'artifact:workflow/release-packet.md',
            summary: 'Selected work-item release packet',
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
          activeTaskCount: 1,
          activeWorkItemCount: 1,
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
            descriptor_id: 'workflow-deliverable',
            workflow_id: 'workflow-1',
            work_item_id: null,
            descriptor_kind: 'brief_packet',
            delivery_stage: 'final',
            title: 'Workflow summary packet',
            state: 'final',
            summary_brief: 'Workflow-level output',
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
            descriptor_id: 'workflow-deliverable',
            workflow_id: 'workflow-1',
            work_item_id: null,
            descriptor_kind: 'brief_packet',
            delivery_stage: 'final',
            title: 'Workflow summary packet',
            state: 'final',
            summary_brief: 'Workflow-level output',
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

    expect(result.deliverables.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'workflow-deliverable',
        work_item_id: null,
      }),
    ]);
    expect(result.deliverables.in_progress_deliverables).toEqual([]);
    expect(result.bottom_tabs.counts.deliverables).toBe(1);
  });

});
