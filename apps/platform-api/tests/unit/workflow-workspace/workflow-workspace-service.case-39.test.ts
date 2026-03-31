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
  it('filters task-scoped live console and briefs to task-linked records before computing counts', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'active', is_terminal: false }],
        work_items: [],
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
            item_id: 'work-item-only',
            item_kind: 'execution_turn',
            source_kind: 'specialist',
            source_label: 'Verifier',
            headline: 'Work-item update',
            summary: 'Work-item update',
            created_at: '2026-03-27T22:45:00.000Z',
            work_item_id: 'work-item-1',
            task_id: null,
            linked_target_ids: ['workflow-1', 'work-item-1'],
          },
          {
            item_id: 'task-linked',
            item_kind: 'execution_turn',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            headline: 'Task-linked update',
            summary: 'Task-linked update',
            created_at: '2026-03-27T22:44:00.000Z',
            work_item_id: null,
            task_id: null,
            linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
          },
        ],
        next_cursor: null,
        live_visibility_mode: 'enhanced',
      })),
    };
    const historyService = {
      getHistory: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        groups: [{
          group_id: '2026-03-27',
          item_ids: ['history-work-item', 'history-task'],
          label: '2026-03-27',
          anchor_at: '2026-03-27T00:00:00.000Z',
        }],
        items: [
          {
            item_id: 'history-work-item',
            item_kind: 'milestone_brief',
            source_kind: 'specialist',
            source_label: 'Verifier',
            headline: 'Work-item brief',
            summary: 'Work-item brief',
            created_at: '2026-03-27T22:45:00.000Z',
            work_item_id: 'work-item-1',
            task_id: null,
            linked_target_ids: ['workflow-1', 'work-item-1'],
          },
          {
            item_id: 'history-task',
            item_kind: 'milestone_brief',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            headline: 'Task brief',
            summary: 'Task brief',
            created_at: '2026-03-27T22:44:00.000Z',
            work_item_id: null,
            task_id: null,
            linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
          },
        ],
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
    const taskBriefsService = {
      getBriefs: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        items: [
          {
            brief_id: 'brief-work-item',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: null,
            request_id: 'request-1',
            execution_context_id: 'execution-1',
            brief_kind: 'milestone',
            brief_scope: 'workflow_timeline',
            source_kind: 'specialist',
            source_label: 'Verifier',
            source_role_name: 'Verifier',
            headline: 'Work-item brief',
            summary: 'Work-item brief',
            llm_turn_count: null,
            status_kind: 'handoff',
            short_brief: { headline: 'Work-item brief' },
            detailed_brief_json: { summary: 'Work-item brief' },
            linked_target_ids: ['workflow-1', 'work-item-1'],
            sequence_number: 2,
            related_artifact_ids: [],
            related_output_descriptor_ids: [],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: '2026-03-27T22:45:00.000Z',
            updated_at: '2026-03-27T22:45:00.000Z',
          },
          {
            brief_id: 'brief-task',
            workflow_id: 'workflow-1',
            work_item_id: null,
            task_id: null,
            request_id: 'request-2',
            execution_context_id: 'execution-2',
            brief_kind: 'milestone',
            brief_scope: 'workflow_timeline',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            source_role_name: 'Orchestrator',
            headline: 'Task brief',
            summary: 'Task brief',
            llm_turn_count: null,
            status_kind: 'handoff',
            short_brief: { headline: 'Task brief' },
            detailed_brief_json: { summary: 'Task brief' },
            linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
            sequence_number: 1,
            related_artifact_ids: [],
            related_output_descriptor_ids: [],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: '2026-03-27T22:44:00.000Z',
            updated_at: '2026-03-27T22:44:00.000Z',
          },
        ],
        total_count: 2,
        next_cursor: null,
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
      taskBriefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      taskId: 'task-1',
      tabScope: 'selected_task',
    });

    expect(result.live_console.items.map((item) => item.item_id)).toEqual(['task-linked']);
    expect(result.briefs.items.map((item) => item.brief_id)).toEqual(['brief-task']);
    expect(result.history.items.map((item) => item.item_id)).toEqual(['history-task']);
    expect(result.history.groups).toEqual([
      expect.objectContaining({
        item_ids: ['history-task'],
      }),
    ]);
    expect(result.bottom_tabs.counts.live_console_activity).toBe(1);
    expect(result.bottom_tabs.counts.briefs).toBe(1);
    expect(result.bottom_tabs.counts.history).toBe(1);
  });

});
