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
  it('keeps selected work-item and task scopes free of workflow-scoped rollup deliverables', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [],
        work_items: [],
        active_stages: [],
        awaiting_gate_count: 0,
        stage_summary: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'active',
        state: 'active',
        pulse: { summary: 'Running' },
        availableActions: [],
        outputDescriptors: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 0,
          activeTaskCount: 0,
          activeWorkItemCount: 0,
          lastChangedAt: '2026-03-29T18:05:00.000Z',
        },
      })),
    };
    const liveConsoleService = {
      getLiveConsole: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:200',
        generated_at: '2026-03-29T18:05:00.000Z',
        latest_event_id: 200,
        items: [],
        total_count: 0,
        counts: { all: 0, turn_updates: 0, briefs: 0 },
        next_cursor: null,
        live_visibility_mode: 'enhanced',
      })),
    };
    const historyService = {
      getHistory: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:200',
        generated_at: '2026-03-29T18:05:00.000Z',
        latest_event_id: 200,
        groups: [],
        items: [],
        total_count: 0,
        filters: { available: ['briefs'], active: [] },
        next_cursor: null,
      })),
    };
    const deliverablesService = {
      getDeliverables: vi.fn(async () => ({
        final_deliverables: [
          {
            descriptor_id: 'workflow-rollup',
            workflow_id: 'workflow-1',
            work_item_id: null,
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Workflow rollup',
            state: 'final',
            summary_brief: 'Workflow rollup',
            preview_capabilities: {},
            primary_target: {},
            secondary_targets: [],
            content_preview: {},
            source_brief_id: null,
            created_at: '2026-03-29T18:04:00.000Z',
            updated_at: '2026-03-29T18:04:00.000Z',
          },
          {
            descriptor_id: 'work-item-output',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Work-item output',
            state: 'final',
            summary_brief: 'Work-item output',
            preview_capabilities: {},
            primary_target: {},
            secondary_targets: [],
            content_preview: {},
            source_brief_id: null,
            created_at: '2026-03-29T18:04:30.000Z',
            updated_at: '2026-03-29T18:04:30.000Z',
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
            descriptor_id: 'workflow-rollup',
            workflow_id: 'workflow-1',
            work_item_id: null,
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Workflow rollup',
            state: 'final',
            summary_brief: 'Workflow rollup',
            preview_capabilities: {},
            primary_target: {},
            secondary_targets: [],
            content_preview: {},
            source_brief_id: null,
            created_at: '2026-03-29T18:04:00.000Z',
            updated_at: '2026-03-29T18:04:00.000Z',
          },
          {
            descriptor_id: 'work-item-output',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Work-item output',
            state: 'final',
            summary_brief: 'Work-item output',
            preview_capabilities: {},
            primary_target: {},
            secondary_targets: [],
            content_preview: {},
            source_brief_id: null,
            created_at: '2026-03-29T18:04:30.000Z',
            updated_at: '2026-03-29T18:04:30.000Z',
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

    const workItemScoped = await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_work_item',
      workItemId: 'work-item-1',
    });
    const taskScoped = await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_task',
      workItemId: 'work-item-1',
      taskId: 'task-1',
    });

    expect(workItemScoped.deliverables.final_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'work-item-output', work_item_id: 'work-item-1' }),
    ]);
    expect(taskScoped.deliverables.final_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'work-item-output', work_item_id: 'work-item-1' }),
    ]);
  });

});
