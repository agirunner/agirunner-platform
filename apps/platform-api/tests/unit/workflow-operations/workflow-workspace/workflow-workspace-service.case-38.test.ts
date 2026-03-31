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
  it('keeps task-linked briefs for a selected work item even when the stored brief has no direct work-item id', async () => {
    const selectedTaskId = '4fcd3b55-450c-4379-80ec-c49ac77d7f27';
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'active', is_terminal: false }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'workflows-intake-01',
            column_id: 'active',
            tasks: [{ id: selectedTaskId }],
          },
          {
            id: 'work-item-2',
            title: 'workflows-intake-02',
            column_id: 'active',
            tasks: [{ id: '5fd22651-0137-43f5-a30a-8cd3368e1541' }],
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
        items: [],
        total_count: 0,
        counts: {
          all: 0,
          turn_updates: 0,
          briefs: 0,
          steering: 0,
        },
        next_cursor: null,
        live_visibility_mode: 'enhanced',
        scope_filtered: true,
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
    const briefsService = {
      getBriefs: vi.fn(async (_tenantId, _workflowId, input) => {
        if (input?.workItemId || input?.taskId) {
          return {
            snapshot_version: 'workflow-operations:120',
            generated_at: '2026-03-27T22:45:00.000Z',
            latest_event_id: 120,
            items: [],
            total_count: 0,
            next_cursor: null,
          };
        }
        return {
          snapshot_version: 'workflow-operations:120',
          generated_at: '2026-03-27T22:45:00.000Z',
          latest_event_id: 120,
          items: [
            {
              brief_id: 'brief-task-linked',
              workflow_id: 'workflow-1',
              work_item_id: null,
              task_id: null,
              request_id: 'request-1',
              execution_context_id: 'execution-1',
              brief_kind: 'milestone',
              brief_scope: 'workflow_timeline',
              source_kind: 'orchestrator',
              source_label: 'Orchestrator',
              source_role_name: 'Orchestrator',
              headline: 'Task-linked brief for the selected work item',
              summary: 'A predecessor brief only targeted the selected child task.',
              llm_turn_count: 2,
              status_kind: 'handoff',
              short_brief: { headline: 'Task-linked brief for the selected work item' },
              detailed_brief_json: {
                summary: 'A predecessor brief only targeted the selected child task.',
              },
              linked_target_ids: ['workflow-1', selectedTaskId],
              sequence_number: 1,
              related_artifact_ids: [],
              related_output_descriptor_ids: [],
              related_intervention_ids: [],
              canonical_workflow_brief_id: null,
              created_by_type: 'agent',
              created_by_id: 'agent-1',
              created_at: '2026-03-27T22:45:00.000Z',
              updated_at: '2026-03-27T22:45:00.000Z',
            },
          ],
          total_count: 1,
          next_cursor: null,
        };
      }),
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

    expect(briefsService.getBriefs).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      limit: undefined,
      workItemId: undefined,
      taskId: undefined,
      after: undefined,
    });
    expect(result.briefs.items.map((item) => item.brief_id)).toEqual(['brief-task-linked']);
    expect(result.briefs.total_count).toBe(1);
    expect(result.bottom_tabs.counts.briefs).toBe(1);
  });

});
