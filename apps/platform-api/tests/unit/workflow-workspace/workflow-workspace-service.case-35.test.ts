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
  it('synthesizes scoped live-console and history items for a selected blocked work item with no direct records', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'blocked', is_terminal: false }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'Record human approval decision for blocked workflow brief',
            stage_name: 'approval-gate',
            column_id: 'blocked',
            blocked_state: 'blocked',
            blocked_reason: 'Blocked by the live test operator flow.',
            escalation_status: null,
            gate_status: 'blocked',
            gate_decision_feedback: 'Blocked by the live test operator flow.',
            task_count: 0,
            children_count: 0,
            completed_at: null,
            created_at: '2026-03-27T22:40:00.000Z',
            updated_at: '2026-03-27T22:45:00.000Z',
          },
        ],
        stage_summary: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Approval Workflow',
        posture: 'needs_intervention',
        pulse: { summary: 'Approval gate is blocked' },
        outputDescriptors: [],
        availableActions: [],
        metrics: {
          blockedWorkItemCount: 1,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 0,
          activeTaskCount: 0,
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
      workItemId: 'work-item-1',
      tabScope: 'selected_work_item',
    });

    expect(result.live_console.items).toEqual([]);
    expect(result.history.items).toEqual([]);
    expect(result.bottom_tabs.counts.live_console_activity).toBe(0);
    expect(result.bottom_tabs.counts.history).toBe(0);
  });

});
