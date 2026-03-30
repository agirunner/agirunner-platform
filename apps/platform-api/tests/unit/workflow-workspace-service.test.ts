import { describe, expect, it, vi } from 'vitest';

import { WorkflowWorkspaceService } from '../../src/services/workflow-operations/workflow-workspace-service.js';

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
  it('composes the workflow workspace packet with spec-aligned sub-packets', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({
        parameters: { objective: 'ship the release' },
        context: { attempt_reason: 'baseline' },
        workflow_relations: { parent: null, children: [] },
      })),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'verification' }],
        work_items: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'needs_decision',
        pulse: { summary: 'Waiting on operator approval' },
        availableActions: [{ kind: 'pause_workflow', enabled: true, scope: 'workflow' }],
        metrics: {
          blockedWorkItemCount: 1,
          openEscalationCount: 2,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 1,
          activeTaskCount: 2,
          activeWorkItemCount: 3,
          lastChangedAt: '2026-03-27T22:45:00.000Z',
        },
      })),
    };
    const liveConsoleService = {
      getLiveConsole: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        items: [{ item_id: 'console-1' }],
        total_count: 1,
        next_cursor: null,
        live_visibility_mode: 'enhanced',
      })),
    };
    const historyService = {
      getHistory: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        groups: [{ group_id: '2026-03-27', item_ids: ['history-1'], label: '2026-03-27', anchor_at: '2026-03-27T00:00:00.000Z' }],
        items: [{ item_id: 'history-1', item_kind: 'milestone_brief', headline: 'Ready for approval', summary: 'Review required.', created_at: '2026-03-27T22:44:00.000Z', linked_target_ids: ['workflow-1'] }],
        total_count: 1,
        filters: { available: ['briefs'], active: [] },
        next_cursor: null,
      })),
    };
    const deliverablesService = {
      getDeliverables: vi.fn(async () => ({
        final_deliverables: [{ descriptor_id: 'deliverable-1', title: 'Release Notes' }],
        in_progress_deliverables: [],
        working_handoffs: [],
        inputs_and_provenance: {
          launch_packet: null,
          supplemental_packets: [],
          intervention_attachments: [],
          redrive_packet: null,
        },
        next_cursor: null,
        all_deliverables: [{ descriptor_id: 'deliverable-1', title: 'Release Notes' }],
      })),
    };
    const briefsService = {
      getBriefs: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        items: [{
          brief_id: 'brief-1',
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
          headline: 'Ready for approval',
          summary: 'Review required.',
          llm_turn_count: null,
          status_kind: 'handoff',
          short_brief: { headline: 'Ready for approval' },
          detailed_brief_json: { summary: 'Review required.' },
          linked_target_ids: ['workflow-1'],
          sequence_number: 6,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:44:00.000Z',
          updated_at: '2026-03-27T22:44:00.000Z',
        }],
        total_count: 1,
        next_cursor: null,
      })),
    };
    const interventionService = {
      listWorkflowInterventions: vi.fn(async () => [
        {
          id: 'intervention-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          kind: 'task_action',
          status: 'open',
          structured_action: { kind: 'retry_task' },
          summary: 'Paused for review',
        },
      ]),
    };
    const steeringSessionService = {
      listSessions: vi.fn(async () => [
        {
          id: 'session-1',
          workflow_id: 'workflow-1',
          title: 'Recovery session',
          status: 'open',
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:30:00.000Z',
          updated_at: '2026-03-27T22:40:00.000Z',
        },
      ]),
      listMessages: vi.fn(async () => [
        {
          id: 'message-1',
          workflow_id: 'workflow-1',
          steering_session_id: 'session-1',
          source_kind: 'operator',
          message_kind: 'operator_request',
          headline: 'Focus on approval path first.',
          body: null,
          linked_intervention_id: null,
          linked_input_packet_id: null,
          linked_operator_update_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:31:00.000Z',
        },
      ]),
    };
    const taskService = {
      listTasks: vi.fn(async () => ({
        data: [
          {
            id: 'task-1',
            title: 'Approve release packet',
            role: 'reviewer',
            state: 'awaiting_approval',
            work_item_id: 'work-item-1',
            updated_at: '2026-03-27T22:42:00.000Z',
          },
        ],
      })),
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
      undefined,
      briefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.sticky_strip).toEqual(
      expect.objectContaining({
        workflow_id: 'workflow-1',
        workflow_name: 'Release Workflow',
        steering_available: true,
      }),
    );
    expect(result.workflow).toEqual(
      expect.objectContaining({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'needs_decision',
      }),
    );
    expect(result.selected_scope).toEqual({
      scope_kind: 'workflow',
      work_item_id: null,
      task_id: null,
    });
    expect(result.bottom_tabs).toEqual(
      expect.objectContaining({
        default_tab: 'details',
        counts: expect.objectContaining({
          needs_action: 1,
          steering: 1,
          live_console_activity: 2,
          briefs: 1,
          history: 1,
          deliverables: 1,
        }),
      }),
    );
    expect(result.needs_action).toEqual(
      expect.objectContaining({
        total_count: 1,
        default_sort: 'priority_desc',
        items: [
          expect.objectContaining({
            action_kind: 'retry_task',
            target: { target_kind: 'task', target_id: 'task-1' },
            responses: expect.arrayContaining([
              expect.objectContaining({
                kind: 'retry_task',
                label: 'Retry task',
                target: { target_kind: 'task', target_id: 'task-1' },
              }),
            ]),
          }),
        ],
      }),
    );
    expect(result.steering).toEqual(
      expect.objectContaining({
        quick_actions: [],
        recent_interventions: [],
        session: expect.objectContaining({
          session_id: 'session-1',
          status: 'open',
          messages: [expect.objectContaining({ id: 'message-1' })],
        }),
      }),
    );
    expect(result.live_console).toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ item_id: 'console-1' }),
          expect.objectContaining({
            item_id: 'message-1',
            item_kind: 'steering_message',
            source_label: 'Operator',
          }),
        ]),
        counts: {
          all: 2,
          turn_updates: 0,
          briefs: 0,
          steering: 1,
        },
      }),
    );
    expect(result.history).toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ item_id: 'history-1' })],
      }),
    );
    expect(result.briefs).toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ brief_id: 'brief-1' })],
      }),
    );
    expect(result.deliverables).toEqual(
      expect.objectContaining({
        final_deliverables: [expect.objectContaining({ descriptor_id: 'deliverable-1' })],
      }),
    );
    expect(result.board).toEqual({
      columns: [{ id: 'verification' }],
      work_items: [],
    });
    expect(result).not.toHaveProperty('steering_panel');
    expect(result).not.toHaveProperty('history_timeline');
    expect(result).not.toHaveProperty('deliverables_panel');
    expect(result).not.toHaveProperty('overview');
    expect(result).not.toHaveProperty('outputs');
  });

  it('uses scoped packet totals for bottom-tab counts instead of the current page length', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({ columns: [], work_items: [] })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Workflow 1',
        posture: 'active',
        pulse: { summary: 'Working' },
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
        items: [{ item_id: 'console-1' }, { item_id: 'console-2' }],
        total_count: 44,
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
        items: [{ item_id: 'history-1' }],
        total_count: 61,
        filters: { available: ['briefs'], active: [] },
        next_cursor: 'cursor:history',
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
    const briefsService = {
      getBriefs: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-27T22:45:00.000Z',
        latest_event_id: 120,
        items: [{ brief_id: 'brief-1' }, { brief_id: 'brief-2' }],
        total_count: 17,
        next_cursor: 'cursor:briefs',
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

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.live_console.items).toHaveLength(2);
    expect(result.history.items).toHaveLength(1);
    expect(result.briefs.items).toHaveLength(2);
    expect(result.bottom_tabs.counts.live_console_activity).toBe(44);
    expect(result.bottom_tabs.counts.briefs).toBe(17);
    expect(result.bottom_tabs.counts.history).toBe(61);
  });

  it('uses visible live-console counts instead of deprecated operator-update totals', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({ columns: [], work_items: [] })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Workflow 1',
        posture: 'active',
        pulse: { summary: 'Working' },
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
            item_id: 'update-1',
            item_kind: 'operator_update',
            source_kind: 'operator',
            source_label: 'Operator',
            headline: 'Deprecated update',
            summary: 'Deprecated update',
            created_at: '2026-03-27T22:45:00.000Z',
            work_item_id: null,
            task_id: null,
            linked_target_ids: ['workflow-1'],
          },
          {
            item_id: 'brief-1',
            item_kind: 'milestone_brief',
            source_kind: 'specialist',
            source_label: 'Verifier',
            headline: 'Visible brief',
            summary: 'Visible brief',
            created_at: '2026-03-27T22:44:00.000Z',
            work_item_id: null,
            task_id: null,
            linked_target_ids: ['workflow-1'],
          },
        ],
        total_count: 2,
        counts: {
          all: 1,
          turn_updates: 0,
          briefs: 1,
        },
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

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.live_console.total_count).toBe(1);
    expect(result.live_console.counts).toEqual({
      all: 1,
      turn_updates: 0,
      briefs: 1,
    });
    expect(result.bottom_tabs.counts.live_console_activity).toBe(1);
  });

  it('keeps needs action and steering workflow-scoped unless tabScope explicitly selects the work item', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({ columns: [], work_items: [] })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'needs_decision',
        pulse: { summary: 'Waiting on operator approval' },
        availableActions: [{ kind: 'pause_workflow', enabled: true, scope: 'workflow' }],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 1,
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
    const briefsService = {
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

    await service.getWorkspace('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      tabScope: 'workflow',
    });

    expect(liveConsoleService.getLiveConsole).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      limit: undefined,
      workItemId: undefined,
      after: undefined,
    });
    expect(historyService.getHistory).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      limit: undefined,
      workItemId: undefined,
      after: undefined,
    });
    expect(deliverablesService.getDeliverables).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      limit: undefined,
      workItemId: undefined,
      after: undefined,
    });
  });

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

  it('keeps canonical deliverables scoped to the parent work item when task scope is selected', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({ columns: [], work_items: [] })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'progressing',
        pulse: { summary: 'Shipping outputs' },
        availableActions: [],
        outputDescriptors: [
          {
            id: 'artifact:task-output',
            title: 'artifact:workflow/release-packet.md',
            summary: 'Legacy mission-control task output',
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
    const briefsService = {
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

    await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_task',
      workItemId: 'work-item-1',
      taskId: 'task-1',
    });

    expect(deliverablesService.getDeliverables).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      limit: undefined,
      workItemId: 'work-item-1',
      after: undefined,
    });
  });

  it('keeps matching workflow rollup deliverables visible in selected work-item scope', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({ columns: [], work_items: [] })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'progressing',
        pulse: { summary: 'Shipping outputs' },
        availableActions: [],
        outputDescriptors: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 0,
          activeTaskCount: 1,
          activeWorkItemCount: 1,
          lastChangedAt: '2026-03-29T18:57:23.564Z',
        },
      })),
    };
    const liveConsoleService = {
      getLiveConsole: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-29T18:57:23.564Z',
        latest_event_id: 120,
        items: [],
        next_cursor: null,
        live_visibility_mode: 'enhanced',
      })),
    };
    const historyService = {
      getHistory: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-29T18:57:23.564Z',
        latest_event_id: 120,
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
            descriptor_id: 'workflow-rollup-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Blueprint completion packet',
            state: 'final',
            summary_brief: 'Workflow rollup for the completed blueprint work item.',
            preview_capabilities: {},
            primary_target: {},
            secondary_targets: [],
            content_preview: {
              rollup_source_descriptor_id: 'work-item-deliverable-1',
              rollup_source_work_item_id: 'work-item-1',
            },
            source_brief_id: null,
            created_at: '2026-03-29T18:57:23.564Z',
            updated_at: '2026-03-29T18:57:23.564Z',
          },
          {
            descriptor_id: 'work-item-deliverable-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Blueprint completion packet',
            state: 'final',
            summary_brief: 'Canonical work-item deliverable.',
            preview_capabilities: {},
            primary_target: {},
            secondary_targets: [],
            content_preview: {},
            source_brief_id: null,
            created_at: '2026-03-29T18:44:23.277Z',
            updated_at: '2026-03-29T18:44:23.277Z',
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
            descriptor_id: 'workflow-rollup-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Blueprint completion packet',
            state: 'final',
            summary_brief: 'Workflow rollup for the completed blueprint work item.',
            preview_capabilities: {},
            primary_target: {},
            secondary_targets: [],
            content_preview: {
              rollup_source_descriptor_id: 'work-item-deliverable-1',
              rollup_source_work_item_id: 'work-item-1',
            },
            source_brief_id: null,
            created_at: '2026-03-29T18:57:23.564Z',
            updated_at: '2026-03-29T18:57:23.564Z',
          },
          {
            descriptor_id: 'work-item-deliverable-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Blueprint completion packet',
            state: 'final',
            summary_brief: 'Canonical work-item deliverable.',
            preview_capabilities: {},
            primary_target: {},
            secondary_targets: [],
            content_preview: {},
            source_brief_id: null,
            created_at: '2026-03-29T18:44:23.277Z',
            updated_at: '2026-03-29T18:44:23.277Z',
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

    const result = await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_work_item',
      workItemId: 'work-item-1',
    });

    expect(result.deliverables.final_deliverables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ descriptor_id: 'work-item-deliverable-1', work_item_id: 'work-item-1' }),
        expect.objectContaining({ descriptor_id: 'workflow-rollup-1', work_item_id: null }),
      ]),
    );
    expect(result.deliverables.final_deliverables).toHaveLength(2);
  });

  it('supports selected task scope without a work item id for orchestrator tasks', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [],
        work_items: [{ id: 'work-item-1' }],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'progressing',
        pulse: { summary: 'Orchestrator is driving the next step' },
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
        items: [
          {
            item_id: 'orchestrator-turn',
            item_kind: 'execution_turn',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            headline: '[Act] Route the next specialist task.',
            summary: 'Routing the next specialist task.',
            created_at: '2026-03-28T05:00:00.000Z',
            work_item_id: null,
            task_id: 'task-orchestrator',
            linked_target_ids: ['workflow-1', 'task-orchestrator'],
            scope_binding: 'execution_context',
          },
        ],
        total_count: 1,
        next_cursor: null,
        live_visibility_mode: 'enhanced',
      })),
    };
    const historyService = {
      getHistory: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:140',
        generated_at: '2026-03-28T05:00:00.000Z',
        latest_event_id: 140,
        groups: [
          {
            group_id: '2026-03-28',
            label: '2026-03-28',
            anchor_at: '2026-03-28T00:00:00.000Z',
            item_ids: ['history-orchestrator'],
          },
        ],
        items: [
          {
            item_id: 'history-orchestrator',
            item_kind: 'milestone_brief',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            headline: 'Queued the next activation.',
            summary: 'Queued the next activation.',
            created_at: '2026-03-28T04:59:00.000Z',
            work_item_id: null,
            task_id: 'task-orchestrator',
            linked_target_ids: ['workflow-1', 'task-orchestrator'],
          },
        ],
        total_count: 1,
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
    const briefsService = {
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
      tabScope: 'selected_task',
      taskId: 'task-orchestrator',
    });

    expect(liveConsoleService.getLiveConsole).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      limit: undefined,
      workItemId: undefined,
      taskId: 'task-orchestrator',
      after: undefined,
    });
    expect(historyService.getHistory).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      limit: undefined,
      workItemId: undefined,
      taskId: 'task-orchestrator',
      after: undefined,
    });
    expect(result.selected_scope).toEqual({
      scope_kind: 'selected_task',
      work_item_id: null,
      task_id: 'task-orchestrator',
    });
    expect(result.bottom_tabs).toEqual(
      expect.objectContaining({
        current_scope_kind: 'selected_task',
        current_work_item_id: null,
        current_task_id: 'task-orchestrator',
        counts: expect.objectContaining({
          live_console_activity: 1,
          history: 1,
        }),
      }),
    );
    expect(result.live_console.items.map((item) => item.item_id)).toEqual(['orchestrator-turn']);
    expect(result.live_console.total_count).toBe(1);
    expect(result.history.items.map((item) => item.item_id)).toEqual(['history-orchestrator']);
    expect(result.history.total_count).toBe(1);
  });

  it('keeps work-item context on intervention-sourced escalation responses', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({ columns: [], work_items: [] })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Recovery Workflow',
        posture: 'needs_intervention',
        pulse: { summary: 'Waiting on operator escalation guidance' },
        availableActions: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 1,
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
          id: 'intervention-escalation-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-7',
          task_id: 'task-escalated-7',
          kind: 'task_action',
          status: 'open',
          structured_action: { kind: 'resolve_escalation' },
          summary: 'Operator guidance is required before the task can continue.',
        },
      ]),
    };
    const steeringSessionService = {
      listSessions: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
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

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.needs_action.items).toEqual([
      expect.objectContaining({
        action_kind: 'resolve_escalation',
        target: { target_kind: 'task', target_id: 'task-escalated-7' },
        responses: [
          expect.objectContaining({
            kind: 'resolve_escalation',
            work_item_id: 'work-item-7',
            target: { target_kind: 'task', target_id: 'task-escalated-7' },
          }),
        ],
      }),
    ]);
  });

  it('includes direct approval actions for awaiting-approval task decisions in needs action', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'review' }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'Review release packet',
            stage_name: 'approval',
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
        name: 'Release Workflow',
        posture: 'needs_decision',
        pulse: { summary: 'Waiting on operator approval' },
        availableActions: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 1,
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
    const briefsService = {
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
    const taskService = {
      listTasks: vi.fn(async (_tenantId: string, query: { state?: string }) => ({
        data:
          query.state === 'awaiting_approval'
            ? [
                {
                  id: 'task-approve-1',
                  title: 'Approve release packet',
                  role: 'reviewer',
                  state: 'awaiting_approval',
                  work_item_id: 'work-item-1',
                  updated_at: '2026-03-27T22:42:00.000Z',
                  description: 'Release packet draft and rollback notes are assembled for sign-off.',
                  input: {
                    subject_revision: 3,
                  },
                  verification: {
                    summary: 'Release packet verification passed and the required artifacts are attached.',
                  },
                },
              ]
            : [],
      })),
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

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.needs_action.items).toEqual([
      expect.objectContaining({
        action_kind: 'review_work_item',
        label: 'Approval required',
        summary: 'Review release packet is waiting for operator approval on Approve release packet.',
        target: { target_kind: 'task', target_id: 'task-approve-1' },
        details: [
          { label: 'Approval target', value: 'Approve release packet' },
          { label: 'Context', value: 'Release packet draft and rollback notes are assembled for sign-off.' },
          {
            label: 'Verification',
            value: 'Release packet verification passed and the required artifacts are attached.',
          },
          { label: 'Revision', value: '3' },
        ],
        responses: [
          expect.objectContaining({
            kind: 'approve_task',
            label: 'Approve',
            work_item_id: 'work-item-1',
            target: { target_kind: 'task', target_id: 'task-approve-1' },
          }),
          expect.objectContaining({
            kind: 'reject_task',
            label: 'Reject',
            prompt_kind: 'feedback',
            work_item_id: 'work-item-1',
            target: { target_kind: 'task', target_id: 'task-approve-1' },
          }),
          expect.objectContaining({
            kind: 'request_changes_task',
            label: 'Request changes',
            prompt_kind: 'feedback',
            work_item_id: 'work-item-1',
            target: { target_kind: 'task', target_id: 'task-approve-1' },
          }),
        ],
      }),
    ]);
  });

  it('surfaces escalated task metadata in needs action instead of generic open-escalation copy', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'review' }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'workflows-intake-02',
            stage_name: 'policy-review',
            column_id: 'review',
            gate_status: null,
            escalation_status: 'open',
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
        name: 'Release Workflow',
        posture: 'needs_intervention',
        pulse: { summary: 'Waiting on escalation guidance' },
        availableActions: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 1,
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
    const briefsService = {
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
    const taskService = {
      listTasks: vi.fn(async (_tenantId: string, query: { state?: string }) => ({
        data:
          query.state === 'escalated'
            ? [
                {
                  id: '771908c8-0634-467a-b41d-6dd4a6798d7d',
                  title: 'Review intake summary',
                  role: 'policy-reviewer',
                  state: 'escalated',
                  work_item_id: 'work-item-1',
                  updated_at: '2026-03-27T22:42:00.000Z',
                  metadata: {
                    escalation_reason: 'submit_handoff replay mismatch conflict',
                    escalation_context:
                      'item content is ready for policy review, summary file already written',
                    escalation_work_so_far:
                      'reviewed context, wrote summary, submit_handoff rejected once',
                  },
                },
              ]
            : [],
      })),
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

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.needs_action.items).toEqual([
      expect.objectContaining({
        action_id: 'work-item-1:open_escalation',
        action_kind: 'resolve_escalation',
        label: 'Resolve escalation',
        summary:
          'workflows-intake-02 needs escalation resolution: submit_handoff replay mismatch conflict.',
        target: {
          target_kind: 'task',
          target_id: '771908c8-0634-467a-b41d-6dd4a6798d7d',
        },
        details: [
          {
            label: 'Context',
            value: 'item content is ready for policy review, summary file already written',
          },
          {
            label: 'Work so far',
            value: 'reviewed context, wrote summary, submit_handoff rejected once',
          },
        ],
        responses: [
          expect.objectContaining({
            kind: 'resolve_escalation',
            label: 'Resume with guidance',
            work_item_id: 'work-item-1',
            target: {
              target_kind: 'task',
              target_id: '771908c8-0634-467a-b41d-6dd4a6798d7d',
            },
          }),
        ],
      }),
    ]);
  });

  it('surfaces replay-conflict escalation guidance inline when structured escalation context is present', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'review' }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'workflows-intake-02',
            stage_name: 'policy-review',
            column_id: 'review',
            gate_status: null,
            escalation_status: 'open',
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
        name: 'Release Workflow',
        state: 'active',
        posture: 'needs_intervention',
        pulse: { summary: 'Waiting on escalation guidance' },
        availableActions: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 1,
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
    const interventionService = {
      listWorkflowInterventions: vi.fn(async () => []),
    };
    const steeringSessionService = {
      listSessions: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
    };
    const taskService = {
      listTasks: vi.fn(async (_tenantId: string, query: { state?: string }) => ({
        data:
          query.state === 'escalated'
            ? [
                {
                  id: 'task-1',
                  title: 'Review intake summary',
                  role: 'policy-reviewer',
                  state: 'escalated',
                  work_item_id: 'work-item-1',
                  updated_at: '2026-03-27T22:42:00.000Z',
                  metadata: {
                    escalation_reason: 'submit_handoff replay mismatch conflict',
                    escalation_context:
                      'Task completion is blocked by platform handoff replay conflicts.',
                    escalation_work_so_far:
                      'I compared the current attempt against the stored task handoff and stopped before retrying.',
                    escalation_context_packet: {
                      conflicting_request_ids: {
                        submitted_request_id: 'req-new',
                        persisted_request_id: 'req-old',
                        current_attempt_request_id: 'req-current',
                      },
                      existing_handoff: {
                        id: 'handoff-1',
                        request_id: 'req-old',
                        summary: 'Persisted policy review handoff',
                        completion_state: 'full',
                        decision_state: null,
                      },
                      task_contract_satisfied_by_persisted_handoff: true,
                      conflict_source: 'different_request_id_after_persisted_handoff',
                    },
                  },
                },
              ]
            : [],
      })),
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
      undefined,
      briefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.needs_action.items).toEqual([
      expect.objectContaining({
        action_kind: 'resolve_escalation',
        details: expect.arrayContaining([
          {
            label: 'Conflicting request ids',
            value: 'Submitted req-new; persisted req-old; current attempt req-current',
          },
          {
            label: 'Persisted handoff',
            value: 'Persisted policy review handoff (req-old, full)',
          },
          {
            label: 'Completion contract',
            value: 'Already satisfied by the persisted handoff.',
          },
        ]),
      }),
    ]);
  });

  it('includes stage-gate approval actions for awaiting-approval work items when no direct task is actionable', async () => {
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
    const briefsService = {
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
    const taskService = {
      listTasks: vi.fn(async () => ({ data: [] })),
    };
    const gateSource = {
      listWorkflowGates: vi.fn(async () => [
        {
          gate_id: 'gate-1',
          stage_name: 'approval-gate',
          status: 'awaiting_approval',
          request_summary: 'Ready for signoff after editorial and policy review.',
          recommendation: 'approve',
          concerns: ['Confirm final owner attribution before publishing.'],
          requested_by_work_item_id: 'work-item-1',
          requested_by_work_item_title: 'Approve Curiosity Deck brief',
          requested_by_task_title: 'Package approval brief',
        },
      ]),
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

    expect(result.needs_action.items).toEqual([
      expect.objectContaining({
        action_kind: 'review_work_item',
        label: 'Approval required',
        summary: 'Approve Curiosity Deck brief is waiting for operator approval: Ready for signoff after editorial and policy review.',
        target: { target_kind: 'work_item', target_id: 'work-item-1' },
        details: [
          { label: 'Recommendation', value: 'Approve' },
          { label: 'Requested by', value: 'Package approval brief' },
          { label: 'Concerns', value: 'Confirm final owner attribution before publishing.' },
        ],
        responses: [
          expect.objectContaining({
            kind: 'approve_gate',
            label: 'Approve',
            target: { target_kind: 'gate', target_id: 'gate-1' },
          }),
          expect.objectContaining({
            kind: 'reject_gate',
            label: 'Reject',
            target: { target_kind: 'gate', target_id: 'gate-1' },
            prompt_kind: 'feedback',
          }),
          expect.objectContaining({
            kind: 'request_changes_gate',
            label: 'Request changes',
            target: { target_kind: 'gate', target_id: 'gate-1' },
            prompt_kind: 'feedback',
          }),
        ],
      }),
    ]);
  });

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

  it('drops stale open-escalation items when no escalated task still exists', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'review' }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'workflows-intake-02',
            stage_name: 'policy-review',
            column_id: 'review',
            gate_status: null,
            escalation_status: 'open',
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
        name: 'Release Workflow',
        posture: 'needs_intervention',
        pulse: { summary: 'Waiting on escalation guidance' },
        availableActions: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 1,
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

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.needs_action.items).toEqual([]);
    expect(result.needs_action.total_count).toBe(0);
  });

  it('surfaces request-changes work items as actionable add-work entries instead of leaving them stranded in planned', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'planned' }, { id: 'blocked', is_blocked: true }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'Revise release packet',
            stage_name: 'approval',
            column_id: 'planned',
            gate_status: 'request_changes',
            gate_decision_feedback: 'Add rollback notes before resubmitting.',
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
        name: 'Release Workflow',
        posture: 'needs_intervention',
        pulse: { summary: 'Requested changes are still outstanding' },
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
      undefined,
      undefined,
      briefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.needs_action.items).toEqual([
      expect.objectContaining({
        action_kind: 'unblock_work_item',
        label: 'Address requested changes',
        summary: 'Revise release packet is blocked: Add rollback notes before resubmitting.',
        target: { target_kind: 'work_item', target_id: 'work-item-1' },
        responses: [
          expect.objectContaining({
            kind: 'add_work_item',
            label: 'Add / Modify Work',
            target: { target_kind: 'work_item', target_id: 'work-item-1' },
          }),
        ],
      }),
    ]);
    expect(result.bottom_tabs.default_tab).toBe('details');
  });

  it('keeps generic workflow controls out of needs action while surfacing real workflow interventions', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'active', is_terminal: false }],
        work_items: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'progressing',
        pulse: { summary: 'One task in flight' },
        availableActions: [
          { kind: 'pause_workflow', enabled: true, scope: 'workflow', confirmationLevel: 'immediate' },
          { kind: 'cancel_workflow', enabled: true, scope: 'workflow', confirmationLevel: 'high_impact_confirm' },
          { kind: 'add_work_item', enabled: true, scope: 'workflow', confirmationLevel: 'standard_confirm' },
          { kind: 'redrive_workflow', enabled: true, scope: 'workflow', confirmationLevel: 'high_impact_confirm' },
        ],
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
      undefined,
      undefined,
      briefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.needs_action.total_count).toBe(0);
    expect(result.needs_action.items).toEqual([]);
    expect(result.steering.quick_actions).toEqual([]);
    expect(result.sticky_strip).toEqual(
      expect.objectContaining({
        steering_available: false,
      }),
    );
    expect(result.bottom_tabs.default_tab).toBe('details');
  });

  it('preserves already-scoped live-console packets instead of dropping scoped rows during workspace composition', async () => {
    const service = new WorkflowWorkspaceService(
      {
        getWorkflow: vi.fn(async () => ({
          parameters: {},
          context: {},
          workflow_relations: { parent: null, children: [] },
        })),
        getWorkflowBoard: vi.fn(async () => ({
          columns: [],
          work_items: [{ id: 'work-item-1' }],
        })),
      } as never,
      {
        getWorkflowCard: vi.fn(async () => ({
          id: 'workflow-1',
          name: 'Workflow 1',
          state: 'active',
          posture: 'progressing',
          pulse: { summary: 'Active.' },
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
            lastChangedAt: '2026-03-28T00:00:00.000Z',
          },
        })),
      } as never,
      {
        getLiveConsole: vi.fn(async () => ({
          snapshot_version: 'workflow-operations:1',
          generated_at: '2026-03-28T00:00:00.000Z',
          latest_event_id: 1,
          items: [{
            item_id: 'execution-log:log-1',
            item_kind: 'execution_turn',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            headline: '[Plan] Waiting on the selected work item response.',
            summary: 'Already scoped upstream.',
            created_at: '2026-03-28T00:00:00.000Z',
            work_item_id: null,
            task_id: null,
            linked_target_ids: [],
            scope_binding: 'execution_context',
          }],
          total_count: 1,
          counts: {
            all: 1,
            turn_updates: 1,
            briefs: 0,
          },
          next_cursor: null,
          scope_filtered: true,
          live_visibility_mode: 'enhanced',
        })),
      } as never,
      {
        getHistory: vi.fn(async () => ({
          snapshot_version: 'workflow-operations:1',
          generated_at: '2026-03-28T00:00:00.000Z',
          latest_event_id: 1,
          groups: [],
          items: [],
          total_count: 0,
          filters: { available: [], active: [] },
          next_cursor: null,
        })),
      } as never,
      {
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
      } as never,
      {
        listWorkflowInterventions: vi.fn(async () => []),
      } as never,
      {
        listSessions: vi.fn(async () => []),
        listMessages: vi.fn(async () => []),
      } as never,
      undefined,
      undefined,
      briefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_work_item',
      workItemId: 'work-item-1',
    });

    expect(result.live_console.total_count).toBe(1);
    expect(result.live_console.counts).toEqual({
      all: 1,
      turn_updates: 1,
      briefs: 0,
    });
    expect(result.live_console.items).toEqual([
      expect.objectContaining({
        item_id: 'execution-log:log-1',
      }),
    ]);
  });

  it('surfaces workflow-scoped stage-gate attention when the board has no actionable work items', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'review', is_terminal: false }],
        work_items: [],
        stage_summary: [
          {
            name: 'review',
            goal: 'Review the release packet',
            status: 'awaiting_gate',
            is_active: true,
            gate_status: 'awaiting_approval',
            work_item_count: 1,
            open_work_item_count: 0,
            completed_count: 1,
          },
        ],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'needs_decision',
        pulse: { summary: 'Waiting on operator approval' },
        availableActions: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 1,
          activeTaskCount: 0,
          activeWorkItemCount: 0,
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
      undefined,
      undefined,
      briefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.needs_action.total_count).toBe(1);
    expect(result.needs_action.items).toEqual([
      expect.objectContaining({
        action_kind: 'review_stage_gate',
        label: 'Approval required',
        summary: 'Stage review is waiting for operator approval.',
        target: { target_kind: 'workflow', target_id: 'workflow-1' },
        priority: 'high',
      }),
    ]);
    expect(result.bottom_tabs.default_tab).toBe('details');
  });

  it('keeps pause, resume, cancel, and add-work out of steering quick actions because the header owns lifecycle controls', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'verification' }],
        work_items: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'paused',
        pulse: { summary: 'Workflow paused' },
        availableActions: [
          { kind: 'pause_workflow', enabled: false, scope: 'workflow' },
          { kind: 'resume_workflow', enabled: true, scope: 'workflow' },
          { kind: 'cancel_workflow', enabled: true, scope: 'workflow' },
          { kind: 'add_work_item', enabled: false, scope: 'workflow' },
          { kind: 'retry_task', enabled: true, scope: 'task' },
        ],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 0,
          activeTaskCount: 0,
          activeWorkItemCount: 0,
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

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.steering.quick_actions).toEqual([
      expect.objectContaining({ kind: 'retry_task', scope: 'task', enabled: true }),
    ]);
    expect(result.steering.quick_actions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'pause_workflow' }),
        expect.objectContaining({ kind: 'resume_workflow' }),
        expect.objectContaining({ kind: 'cancel_workflow' }),
        expect.objectContaining({ kind: 'add_work_item' }),
      ]),
    );
  });

  it('disables steering requests when the workflow itself is paused', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'verification' }],
        work_items: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        state: 'paused',
        posture: 'paused',
        pulse: { summary: 'Workflow paused' },
        availableActions: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 0,
          activeTaskCount: 0,
          activeWorkItemCount: 0,
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

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.steering.steering_state.can_accept_request).toBe(false);
  });

  it('includes blocker detail in needs-action summaries without polluting deliverables from workflow cards', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'blocked', is_terminal: false }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'Review final approval packet',
            stage_name: 'approval-gate',
            column_id: 'blocked',
            blocked_state: 'blocked',
            blocked_reason: 'Waiting on legal sign-off before launch packaging can start.',
            escalation_status: null,
            gate_status: 'blocked',
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
        posture: 'needs_intervention',
        pulse: { summary: 'Waiting on legal sign-off' },
        outputDescriptors: [
          {
            id: 'artifact:1',
            title: 'artifact:workflow/release-packet.md',
            summary: 'Release packet draft',
            status: 'draft',
            producedByRole: null,
            workItemId: 'work-item-1',
            taskId: 'task-1',
            stageName: 'approval-gate',
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
      undefined,
      undefined,
      briefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.needs_action.items).toEqual([
      expect.objectContaining({
        action_kind: 'unblock_work_item',
        summary: 'Review final approval packet is blocked: Waiting on legal sign-off before launch packaging can start.',
      }),
    ]);
    expect(result.deliverables.in_progress_deliverables).toEqual([]);
    expect(result.history.items).toEqual([]);
    expect(result.bottom_tabs.counts.deliverables).toBe(0);
    expect(result.bottom_tabs.counts.history).toBe(0);
  });

  it('scopes fallback output descriptors to the selected work item deliverables view', async () => {
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
          {
            id: 'work-item-2',
            title: 'Write blog post',
            stage_name: 'launch',
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
            summary: 'Release packet draft',
            status: 'draft',
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
          {
            id: 'artifact:other',
            title: 'artifact:workflow/blog-post.md',
            summary: 'Blog post draft',
            status: 'draft',
            producedByRole: null,
            workItemId: 'work-item-2',
            taskId: 'task-2',
            stageName: 'launch',
            primaryLocation: {
              kind: 'artifact',
              artifactId: 'artifact-2',
              taskId: 'task-2',
              logicalPath: 'artifact:workflow/blog-post.md',
              previewPath: '/artifacts/tasks/task-2/artifact-2',
              downloadPath: '/api/v1/tasks/task-2/artifacts/artifact-2',
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
          activeTaskCount: 2,
          activeWorkItemCount: 2,
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
      tabScope: 'selected_work_item',
      workItemId: 'work-item-1',
    });

    expect(result.deliverables.final_deliverables).toEqual([]);
    expect(result.deliverables.in_progress_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'output:artifact:matching',
        work_item_id: 'work-item-1',
        title: 'artifact:workflow/release-packet.md',
        state: 'draft',
        delivery_stage: 'in_progress',
        primary_target: expect.objectContaining({
          target_kind: 'artifact',
          artifact_id: 'artifact-1',
          url: '/api/v1/tasks/task-1/artifacts/artifact-1/preview',
        }),
      }),
    ]);
    expect(result.deliverables.final_deliverables).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ descriptor_id: 'output:artifact:other' })]),
    );
    expect(result.bottom_tabs.counts.deliverables).toBe(1);
  });

  it('keeps a workflow-scoped deliverable visible while still synthesizing the selected work-item fallback deliverable', async () => {
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
            summary: 'Release packet draft',
            status: 'draft',
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
        total_count: 0,
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
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Program status brief',
            state: 'final',
            summary_brief: 'Workflow-wide status is ready.',
            preview_capabilities: {},
            primary_target: {
              target_kind: 'inline_summary',
              label: 'Review packet',
            },
            secondary_targets: [],
            content_preview: {
              summary: 'Workflow-wide status is ready.',
            },
            source_brief_id: null,
            created_at: '2026-03-29T18:57:23.564Z',
            updated_at: '2026-03-29T18:57:23.564Z',
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
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Program status brief',
            state: 'final',
            summary_brief: 'Workflow-wide status is ready.',
            preview_capabilities: {},
            primary_target: {
              target_kind: 'inline_summary',
              label: 'Review packet',
            },
            secondary_targets: [],
            content_preview: {
              summary: 'Workflow-wide status is ready.',
            },
            source_brief_id: null,
            created_at: '2026-03-29T18:57:23.564Z',
            updated_at: '2026-03-29T18:57:23.564Z',
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
    expect(result.deliverables.in_progress_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'output:artifact:matching',
        work_item_id: 'work-item-1',
        title: 'artifact:workflow/release-packet.md',
      }),
    ]);
    expect(result.bottom_tabs.counts.deliverables).toBe(2);
  });

  it('keeps workflow-document fallback deliverables visible in selected work-item scope', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'done', is_terminal: true }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'Only work item',
            stage_name: 'terminal',
            column_id: 'done',
            blocked_state: null,
            blocked_reason: null,
            escalation_status: null,
            gate_status: null,
            task_count: 0,
            children_count: 0,
            completed_at: '2026-03-28T05:00:00.000Z',
          },
        ],
        stage_summary: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Planned terminal brief',
        posture: 'completed',
        pulse: { summary: 'Workflow is complete.' },
        outputDescriptors: [
          {
            id: 'workflow-document:terminal-brief',
            title: 'Terminal brief',
            summary: 'Operator-ready terminal brief.',
            status: 'final',
            producedByRole: null,
            workItemId: null,
            taskId: 'task-1',
            stageName: 'terminal',
            primaryLocation: {
              kind: 'workflow_document',
              logicalName: 'Terminal brief',
              location: 'docs/terminal-brief.md',
              artifactId: 'document-1',
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
          activeTaskCount: 0,
          activeWorkItemCount: 0,
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
      tabScope: 'selected_work_item',
      workItemId: 'work-item-1',
    });

    expect(result.deliverables.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'output:workflow-document:terminal-brief',
        work_item_id: null,
        descriptor_kind: 'workflow_document',
        title: 'Terminal brief',
      }),
    ]);
    expect(result.bottom_tabs.counts.deliverables).toBe(1);
  });

  it('keeps rolled-up work-item deliverables visible while still synthesizing a missing workflow fallback deliverable', async () => {
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
            id: 'artifact:workflow-summary',
            title: 'artifact:workflow/program-status.md',
            summary: 'Workflow status brief',
            status: 'draft',
            producedByRole: null,
            workItemId: null,
            taskId: 'task-99',
            stageName: 'workflow',
            primaryLocation: {
              kind: 'artifact',
              artifactId: 'artifact-99',
              taskId: 'task-99',
              logicalPath: 'artifact:workflow/program-status.md',
              previewPath: '/artifacts/tasks/task-99/artifact-99',
              downloadPath: '/api/v1/tasks/task-99/artifacts/artifact-99',
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
        total_count: 0,
        filters: { available: [], active: [] },
        next_cursor: null,
      })),
    };
    const deliverablesService = {
      getDeliverables: vi.fn(async () => ({
        final_deliverables: [
          {
            descriptor_id: 'deliverable-work-item-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Release checklist',
            state: 'final',
            summary_brief: 'Release checklist is complete.',
            preview_capabilities: {},
            primary_target: {
              target_kind: 'inline_summary',
              label: 'Review packet',
            },
            secondary_targets: [],
            content_preview: {
              summary: 'Release checklist is complete.',
            },
            source_brief_id: null,
            created_at: '2026-03-29T18:44:23.277Z',
            updated_at: '2026-03-29T18:44:23.277Z',
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
            descriptor_id: 'deliverable-work-item-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Release checklist',
            state: 'final',
            summary_brief: 'Release checklist is complete.',
            preview_capabilities: {},
            primary_target: {
              target_kind: 'inline_summary',
              label: 'Review packet',
            },
            secondary_targets: [],
            content_preview: {
              summary: 'Release checklist is complete.',
            },
            source_brief_id: null,
            created_at: '2026-03-29T18:44:23.277Z',
            updated_at: '2026-03-29T18:44:23.277Z',
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

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.deliverables.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-work-item-1',
        work_item_id: 'work-item-1',
      }),
    ]);
    expect(result.deliverables.in_progress_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'output:artifact:workflow-summary',
        work_item_id: null,
        title: 'artifact:workflow/program-status.md',
      }),
    ]);
    expect(result.bottom_tabs.counts.deliverables).toBe(2);
  });

  it('assigns deterministic ids to derived fallback output descriptors when the read model id is blank', async () => {
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
            id: '',
            title: 'artifact:workflow/release-packet.md',
            summary: 'Release packet draft',
            status: 'draft',
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

    const firstResult = await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_work_item',
      workItemId: 'work-item-1',
    });
    const secondResult = await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_work_item',
      workItemId: 'work-item-1',
    });

    const firstDescriptorId = (
      firstResult.deliverables.in_progress_deliverables[0] as { descriptor_id: string } | undefined
    )?.descriptor_id;
    const secondDescriptorId = (
      secondResult.deliverables.in_progress_deliverables[0] as { descriptor_id: string } | undefined
    )?.descriptor_id;

    expect(firstDescriptorId).toMatch(/^output:derived:/);
    expect(secondDescriptorId).toBe(firstDescriptorId);
  });

  it('does not use work-item output descriptor fallback when workflow-scope deliverables are empty', async () => {
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
            id: 'artifact:release-design',
            title: 'artifact:workflow/docs/release-audit-design.md',
            summary: 'Current artifact output',
            status: 'final',
            producedByRole: null,
            workItemId: 'work-item-1',
            taskId: 'task-1',
            stageName: 'release',
            primaryLocation: {
              kind: 'artifact',
              artifactId: 'artifact-1',
              taskId: 'task-1',
              logicalPath: 'artifact:workflow/docs/release-audit-design.md',
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
        all_deliverables: [
          {
            descriptor_id: 'deliverable-hidden',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Package release completion packet',
            state: 'final',
            summary_brief: 'Hidden canonical packet',
            preview_capabilities: {},
            primary_target: {
              target_kind: 'inline_summary',
              label: 'Review completion packet',
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
    briefsService.getBriefs = vi.fn(async () => ({
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
    }));

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
      tabScope: 'workflow',
    });

    expect(result.deliverables.final_deliverables).toEqual([]);
    expect(result.deliverables.in_progress_deliverables).toEqual([]);
    expect((result.deliverables as { all_deliverables?: Array<{ descriptor_id: string }> }).all_deliverables).toEqual([]);
    expect(result.bottom_tabs.counts.deliverables).toBe(0);
  });

  it('does not use selected work-item output descriptor fallback in task scope when canonical deliverables are empty', async () => {
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
            id: 'artifact:task-output',
            title: 'artifact:workflow/release-packet.md',
            summary: 'Task-local release packet',
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
    briefsService.getBriefs = vi.fn(async () => ({
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
    }));

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
      tabScope: 'selected_task',
      workItemId: 'work-item-1',
      taskId: 'task-1',
    });

    expect(result.deliverables.final_deliverables).toEqual([]);
    expect(result.deliverables.in_progress_deliverables).toEqual([]);
    expect(result.bottom_tabs.counts.deliverables).toBe(0);
  });

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

  it('keeps selected task scope free of raw output-descriptor fallback deliverables', async () => {
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
            id: 'artifact:task-output',
            title: 'artifact:workflow/release-packet.md',
            summary: 'Task-local release packet',
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
            preview_capabilities: {},
            primary_target: {
              target_kind: 'inline_summary',
              label: 'Review completion packet',
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
            preview_capabilities: {},
            primary_target: {
              target_kind: 'inline_summary',
              label: 'Review completion packet',
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
      tabScope: 'selected_task',
      workItemId: 'work-item-1',
      taskId: 'task-1',
    });

    expect(result.deliverables.final_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'workflow-deliverable' }),
    ]);
    expect(result.deliverables.final_deliverables).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ descriptor_id: 'artifact:task-output' })]),
    );
    expect(result.deliverables.in_progress_deliverables).toEqual([]);
    expect(result.bottom_tabs.counts.deliverables).toBe(1);
  });

  it('does not synthesize task-local output descriptors into deliverables when selected task scope has no canonical packet', async () => {
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
            id: 'artifact:task-output',
            title: 'artifact:workflow/release-packet.md',
            summary: 'Task-local release packet',
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
      tabScope: 'selected_task',
      workItemId: 'work-item-1',
      taskId: 'task-1',
    });

    expect(result.deliverables.final_deliverables).toEqual([]);
    expect(result.deliverables.in_progress_deliverables).toEqual([]);
    expect(result.bottom_tabs.counts.deliverables).toBe(0);
  });

  it('does not duplicate artifact-backed deliverables when a canonical packet already points at the same artifact', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'done', is_terminal: true }],
        work_items: [
          {
            id: 'work-item-1',
            title: 'Package release',
            stage_name: 'release',
            column_id: 'done',
            blocked_state: null,
            blocked_reason: null,
            escalation_status: null,
            gate_status: null,
            task_count: 1,
            children_count: 0,
            completed_at: '2026-03-28T05:00:00.000Z',
          },
        ],
        stage_summary: [],
      })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'waiting_by_design',
        pulse: { summary: 'Release output published' },
        outputDescriptors: [
          {
            id: 'artifact:matching',
            title: 'artifact:workflow/release-packet.md',
            summary: 'Release packet draft',
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
          activeTaskCount: 0,
          activeWorkItemCount: 0,
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
            descriptor_id: 'descriptor-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'handoff_packet',
            delivery_stage: 'final',
            title: 'Package release completion packet',
            state: 'final',
            summary_brief: 'Canonical packet',
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
            descriptor_id: 'descriptor-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'handoff_packet',
            delivery_stage: 'final',
            title: 'Package release completion packet',
            state: 'final',
            summary_brief: 'Canonical packet',
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

    expect(result.deliverables.final_deliverables).toHaveLength(1);
    expect(result.deliverables.final_deliverables[0]).toEqual(
      expect.objectContaining({
        descriptor_id: 'descriptor-1',
        primary_target: expect.objectContaining({
          artifact_id: 'artifact-1',
        }),
      }),
    );
  });

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

  it('trusts selected-scope live-console packets from the live-console service instead of re-filtering them again', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({
        columns: [{ id: 'active', is_terminal: false }],
        work_items: [
          { id: 'work-item-1', title: 'workflows-intake-01', column_id: 'active' },
          { id: 'work-item-2', title: 'workflows-intake-02', column_id: 'active' },
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
            item_id: 'service-scoped-turn',
            item_kind: 'execution_turn',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            headline: '[Plan] Wait for the already-routed assessment on workflows-intake-01.',
            summary: 'Wait for the already-routed assessment on workflows-intake-01.',
            created_at: '2026-03-27T22:45:00.000Z',
            work_item_id: 'work-item-1',
            task_id: null,
            linked_target_ids: ['workflow-1', 'work-item-1', 'work-item-2'],
            scope_binding: 'execution_context',
          },
        ],
        total_count: 1,
        counts: {
          all: 1,
          turn_updates: 1,
          briefs: 0,
        },
        next_cursor: null,
        scope_filtered: true,
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

    expect(result.live_console.items.map((item) => item.item_id)).toEqual(['service-scoped-turn']);
    expect(result.live_console.total_count).toBe(1);
    expect(result.live_console.counts).toEqual({
      all: 1,
      turn_updates: 1,
      briefs: 0,
    });
    expect(result.bottom_tabs.counts.live_console_activity).toBe(1);
  });

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
            item_kind: 'operator_update',
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
            item_kind: 'operator_update',
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
    expect(result.bottom_tabs.counts.live_console_activity).toBe(0);
    expect(result.bottom_tabs.counts.briefs).toBe(1);
    expect(result.bottom_tabs.counts.history).toBe(1);
  });

  it('recomputes live-console filter totals after workspace scope filtering narrows the packet further', async () => {
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
            item_id: 'selected-notice',
            item_kind: 'platform_notice',
            source_kind: 'platform',
            source_label: 'Platform',
            headline: 'Selected notice',
            summary: 'Selected notice',
            created_at: '2026-03-27T22:43:30.000Z',
            work_item_id: null,
            task_id: null,
            linked_target_ids: ['workflow-1', 'work-item-1'],
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
        total_count: 4,
        counts: {
          all: 4,
          turn_updates: 3,
          briefs: 1,
        },
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
      'selected-notice',
    ]);
    expect(result.live_console.total_count).toBe(3);
    expect(result.live_console.counts).toEqual({
      all: 3,
      turn_updates: 2,
      briefs: 1,
      steering: 0,
    });
  });

  it('preserves scoped live-console totals when workspace filtering trims a paginated viewport window', async () => {
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
    expect(result.live_console.total_count).toBe(6);
    expect(result.live_console.counts).toEqual({
      all: 6,
      turn_updates: 5,
      briefs: 1,
    });
    expect(result.bottom_tabs.counts.live_console_activity).toBe(6);
  });

  it('keeps plain workflow-scoped rollup deliverables visible in selected work-item and task scopes', async () => {
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
      expect.objectContaining({ descriptor_id: 'workflow-rollup', work_item_id: null }),
      expect.objectContaining({ descriptor_id: 'work-item-output', work_item_id: 'work-item-1' }),
    ]);
    expect(taskScoped.deliverables.final_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'workflow-rollup', work_item_id: null }),
      expect.objectContaining({ descriptor_id: 'work-item-output', work_item_id: 'work-item-1' }),
    ]);
  });

  it('surfaces only real workflow interventions in workflow scope needs action', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({ columns: [], work_items: [], stage_summary: [] })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'needs_intervention',
        pulse: { summary: 'Workflow needs intervention.' },
        availableActions: [
          { kind: 'add_work_item', enabled: true, scope: 'workflow', confirmationLevel: 'immediate' },
          { kind: 'redrive_workflow', enabled: true, scope: 'workflow', confirmationLevel: 'standard_confirm' },
        ],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 1,
          waitingForDecisionCount: 0,
          activeTaskCount: 0,
          activeWorkItemCount: 0,
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
      undefined,
      undefined,
      briefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.needs_action.items).toEqual([]);
    expect(result.bottom_tabs.counts.needs_action).toBe(0);
    expect((result.needs_action as any).scope_summary).toEqual({
      workflow_total_count: 0,
      selected_scope_total_count: 0,
      scoped_away_workflow_count: 0,
    });
  });

  it('does not count generic workflow controls as scoped-away needs action when a selected work item has nothing actionable', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({ columns: [], work_items: [], stage_summary: [] })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'needs_intervention',
        pulse: { summary: 'Workflow needs intervention.' },
        availableActions: [
          { kind: 'redrive_workflow', enabled: true, scope: 'workflow', confirmationLevel: 'standard_confirm' },
        ],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 1,
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
      undefined,
      undefined,
      briefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_work_item',
      workItemId: 'work-item-7',
    });

    expect(result.needs_action.items).toEqual([]);
    expect(result.needs_action.total_count).toBe(0);
    expect(result.bottom_tabs.counts.needs_action).toBe(0);
    expect((result.needs_action as any).scope_summary).toEqual({
      workflow_total_count: 0,
      selected_scope_total_count: 0,
      scoped_away_workflow_count: 0,
    });
  });
});
