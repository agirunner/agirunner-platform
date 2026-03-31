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
  it('scopes steering history and live-console steering rows to the selected work item when tabScope selects that work item', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({ columns: [], work_items: [] })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        state: 'active',
        posture: 'progressing',
        pulse: { summary: 'In progress' },
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
      listWorkflowInterventions: vi.fn(async () => [
        {
          id: 'workflow-intervention',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          kind: 'steering_request',
          status: 'applied',
          structured_action: {},
          summary: 'Workflow-level steering',
        },
        {
          id: 'work-item-intervention',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: null,
          kind: 'steering_request',
          status: 'applied',
          structured_action: {},
          summary: 'Work-item steering',
        },
      ]),
    };
    const steeringSessionService = {
      listSessions: vi.fn(async () => [
        {
          id: 'workflow-session',
          workflow_id: 'workflow-1',
          work_item_id: null,
          title: 'Workflow session',
          status: 'open',
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:30:00.000Z',
          updated_at: '2026-03-27T22:40:00.000Z',
          last_message_at: '2026-03-27T22:40:00.000Z',
        },
        {
          id: 'work-item-session',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          title: 'Work-item session',
          status: 'open',
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:41:00.000Z',
          updated_at: '2026-03-27T22:45:00.000Z',
          last_message_at: '2026-03-27T22:45:00.000Z',
        },
      ]),
      listMessages: vi.fn(async (_tenantId: string, _workflowId: string, sessionId: string) => [
        {
          id: `${sessionId}-message`,
          workflow_id: 'workflow-1',
          work_item_id: sessionId === 'work-item-session' ? 'work-item-1' : null,
          steering_session_id: sessionId,
          source_kind: 'operator',
          message_kind: 'operator_request',
          headline: sessionId === 'work-item-session' ? 'Work-item steering' : 'Workflow steering',
          body: null,
          linked_intervention_id: null,
          linked_input_packet_id: null,
          linked_operator_update_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:45:00.000Z',
        },
      ]),
    };
    const taskService = {
      listTasks: vi.fn(async () => ({ data: [] })),
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
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      tabScope: 'selected_work_item',
    });

    expect(steeringSessionService.listMessages).toHaveBeenCalledWith('tenant-1', 'workflow-1', 'work-item-session');
    expect(result.steering.recent_interventions).toEqual([
      expect.objectContaining({ id: 'work-item-intervention' }),
    ]);
    expect(result.steering.session).toEqual(
      expect.objectContaining({
        session_id: 'work-item-session',
        messages: [expect.objectContaining({ id: 'work-item-session-message' })],
      }),
    );
    expect(result.live_console.items).toEqual([
      expect.objectContaining({
        item_id: 'work-item-session-message',
        item_kind: 'steering_message',
        source_kind: 'operator',
        source_label: 'Operator',
        headline: 'Work-item steering',
        work_item_id: 'work-item-1',
      }),
    ]);
    expect(result.live_console.counts).toEqual({
      all: 1,
      turn_updates: 0,
      briefs: 0,
      steering: 1,
    });
  });

});
