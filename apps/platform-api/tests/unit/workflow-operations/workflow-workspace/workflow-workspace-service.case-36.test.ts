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
  it('filters selected work-item live-console items to the chosen item and reconciles counts', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'active', is_terminal: false }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'workflows-intake-01',
            stage_name: 'intake-triage',
            column_id: 'active',
            blocked_state: null,
            blocked_reason: null,
            escalation_status: null,
            gate_status: null,
            task_count: 1,
            children_count: 0,
            completed_at: null,
          },
          {
            id: 'work-item-2',
            title: 'workflows-intake-02',
            stage_name: 'intake-triage',
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
        name: 'Ongoing Intake',
        posture: 'progressing',
        pulse: { summary: 'Two intake items are active' },
        outputDescriptors: [],
        availableActions: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 0,
          activeTaskCount: 2,
          activeWorkItemCount: 2,
          lastChangedAt: '2026-03-27T22:45:00.000Z',
        },
      })),
    };
    const liveConsoleService = {
      getLiveConsole: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        items: [
          {
            item_id: 'same-item-brief',
            item_kind: 'milestone_brief',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            headline: 'Policy review dispatched for workflows-intake-01.',
            summary: 'Policy review dispatched for workflows-intake-01.',
            created_at: '2026-03-27T22:45:00.000Z',
            work_item_id: 'work-item-1',
            task_id: null,
            linked_target_ids: ['workflow-1', 'work-item-1'],
            scope_binding: 'record',
          },
          {
            item_id: 'cross-work-item-brief',
            item_kind: 'milestone_brief',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            headline: 'Second intake item routed while the first remains under analyst review',
            summary: 'Second intake item routed while the first remains under analyst review',
            created_at: '2026-03-27T22:44:00.000Z',
            work_item_id: 'work-item-1',
            task_id: null,
            linked_target_ids: ['work-item-1', 'work-item-2'],
            scope_binding: 'record',
          },
          {
            item_id: 'ambiguous-orchestrator-turn',
            item_kind: 'execution_turn',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            headline: '[Plan] Inspect current stage task coverage for both newly created intake items.',
            summary: 'Inspect current stage task coverage for both newly created intake items.',
            created_at: '2026-03-27T22:43:00.000Z',
            work_item_id: 'work-item-1',
            task_id: 'orchestrator-task-1',
            linked_target_ids: ['workflow-1', 'work-item-1', 'orchestrator-task-1'],
            scope_binding: 'execution_context',
          },
          {
            item_id: 'selected-structured-turn',
            item_kind: 'execution_turn',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            headline: '[Act] Creating a task: Assess workflows-intake-01 triage readiness',
            summary: 'Creating a task: Assess workflows-intake-01 triage readiness',
            created_at: '2026-03-27T22:42:00.000Z',
            work_item_id: null,
            task_id: null,
            linked_target_ids: ['workflow-1', 'work-item-1'],
            scope_binding: 'structured_target',
          },
        ],
        total_count: 4,
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

    expect(result.live_console.items.map((item) => item.item_id)).toEqual([
      'same-item-brief',
      'cross-work-item-brief',
      'ambiguous-orchestrator-turn',
      'selected-structured-turn',
    ]);
    expect(result.live_console.total_count).toBe(4);
    expect(result.bottom_tabs.counts.live_console_activity).toBe(4);
  });

});
