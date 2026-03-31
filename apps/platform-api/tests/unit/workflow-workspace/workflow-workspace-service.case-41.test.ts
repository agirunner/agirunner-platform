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
  it('filters workflow-only live-console rows out of selected work-item scope and recomputes the scoped totals', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'active', is_terminal: false }],
        work_items: [{ id: 'work-item-1' }],
        stage_summary: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Approval Workflow',
        posture: 'progressing',
        pulse: { summary: 'Scoped work is active' },
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
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        items: [
          {
            item_id: 'selected-turn',
            item_kind: 'execution_turn',
            source_kind: 'specialist',
            source_label: 'Implementation Engineer',
            headline: '[Act] Publish the updated review packet.',
            summary: 'Publish the updated review packet.',
            created_at: '2026-03-27T22:45:00.000Z',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
            scope_binding: 'execution_context',
          },
          {
            item_id: 'workflow-only',
            item_kind: 'execution_turn',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            headline: '[Plan] Review workflow-wide readiness before dispatch.',
            summary: 'Review workflow-wide readiness before dispatch.',
            created_at: '2026-03-27T22:44:00.000Z',
            work_item_id: null,
            task_id: null,
            linked_target_ids: [],
            scope_binding: 'execution_context',
          },
        ],
        total_count: 2,
        counts: {
          all: 2,
          turn_updates: 2,
          briefs: 0,
          steering: 0,
        },
        next_cursor: null,
        live_visibility_mode: 'enhanced',
        scope_filtered: false,
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

    expect(result.live_console.items.map((item) => item.item_id)).toEqual(['selected-turn']);
    expect(result.live_console.total_count).toBe(1);
    expect(result.live_console.counts).toEqual({
      all: 1,
      turn_updates: 1,
      briefs: 0,
      steering: 0,
    });
    expect(result.bottom_tabs.counts.live_console_activity).toBe(1);
  });

});
