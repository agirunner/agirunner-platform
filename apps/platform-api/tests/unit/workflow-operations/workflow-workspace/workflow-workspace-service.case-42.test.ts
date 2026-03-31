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
  it('recomputes selected work-item live-console totals when workspace narrows an unscoped packet', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'active', is_terminal: false }],
        work_items: [{ id: 'work-item-1' }, { id: 'work-item-2' }],
        stage_summary: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Approval Workflow',
        posture: 'progressing',
        pulse: { summary: 'Task-scoped work is active' },
        outputDescriptors: [],
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
        items: [
          {
            item_id: 'selected-brief',
            item_kind: 'milestone_brief',
            source_kind: 'specialist',
            source_label: 'Verifier',
            headline: 'Selected brief',
            summary: 'Selected brief',
            created_at: '2026-03-27T22:45:00.000Z',
            work_item_id: 'work-item-1',
            task_id: null,
            linked_target_ids: ['workflow-1', 'work-item-1'],
          },
          {
            item_id: 'selected-turn',
            item_kind: 'execution_turn',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            headline: 'Selected turn',
            summary: 'Selected turn',
            created_at: '2026-03-27T22:44:00.000Z',
            work_item_id: null,
            task_id: null,
            linked_target_ids: ['workflow-1', 'work-item-1'],
            scope_binding: 'structured_target',
          },
          {
            item_id: 'other-turn',
            item_kind: 'execution_turn',
            source_kind: 'specialist',
            source_label: 'Implementer',
            headline: 'Other turn',
            summary: 'Other turn',
            created_at: '2026-03-27T22:43:00.000Z',
            work_item_id: 'work-item-2',
            task_id: null,
            linked_target_ids: ['workflow-1', 'work-item-2'],
          },
        ],
        total_count: 6,
        counts: {
          all: 6,
          turn_updates: 5,
          briefs: 1,
        },
        next_cursor: 'cursor:console',
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
        filters: { available: ['briefs'], active: [] },
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
      undefined,
      undefined,
      briefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      tabScope: 'selected_work_item',
    });

    expect(result.live_console.items.map((item) => item.item_id)).toEqual([
      'selected-brief',
      'selected-turn',
    ]);
    expect(result.live_console.total_count).toBe(2);
    expect(result.live_console.counts).toEqual({
      all: 2,
      turn_updates: 1,
      briefs: 1,
      steering: 0,
    });
    expect(result.bottom_tabs.counts.live_console_activity).toBe(2);
  });

});
