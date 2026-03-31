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
          needs_action: 0,
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
        total_count: 0,
        default_sort: 'priority_desc',
        items: [],
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

});
