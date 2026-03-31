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
  it('drops stale awaiting-approval items when no actionable task or gate still exists', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'review' }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'Approve Curiosity Deck brief',
            stage_name: 'approval-gate',
            column_id: 'review',
            gate_status: 'awaiting_approval',
            escalation_status: null,
            blocked_state: null,
            completed_at: null,
          },
        ],
        stage_summary: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Review It',
        posture: 'needs_decision',
        pulse: { summary: 'Waiting on human approval' },
        availableActions: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 1,
          activeTaskCount: 0,
          activeWorkItemCount: 1,
          lastChangedAt: '2026-03-28T08:15:00.000Z',
        },
      })),
    };
    const liveConsoleService = {
      getLiveConsole: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:220',
        generated_at: '2026-03-28T08:15:00.000Z',
        latest_event_id: 220,
        items: [],
        next_cursor: null,
        live_visibility_mode: 'enhanced',
      })),
    };
    const historyService = {
      getHistory: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:220',
        generated_at: '2026-03-28T08:15:00.000Z',
        latest_event_id: 220,
        groups: [],
        items: [],
        filters: { available: [], active: [] },
        next_cursor: null,
      })),
    };
    const deliverablesService = {
      getDeliverables: vi.fn(async () => ({
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
      })),
    };
    const interventionService = {
      listWorkflowInterventions: vi.fn(async () => []),
    };
    const steeringSessionService = {
      listSessions: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
    };
    const taskService = {
      listTasks: vi.fn(async () => ({ data: [] })),
    };
    const gateSource = {
      listWorkflowGates: vi.fn(async () => []),
    };

    const service = new WorkflowWorkspaceService(
      workflowService as never,
      railService as never,
      liveConsoleService as never,
      historyService as never,
      deliverablesService as never,
      interventionService as never,
      steeringSessionService as never,
      taskService as never,
      gateSource as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.needs_action.items).toEqual([]);
    expect(result.needs_action.total_count).toBe(0);
  });

});
