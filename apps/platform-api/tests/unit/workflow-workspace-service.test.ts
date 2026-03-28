import { describe, expect, it, vi } from 'vitest';

import { WorkflowWorkspaceService } from '../../src/services/workflow-operations/workflow-workspace-service.js';

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
        default_tab: 'needs_action',
        counts: expect.objectContaining({
          needs_action: 1,
          steering: 1,
          live_console_activity: 1,
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
        recent_interventions: [expect.objectContaining({ id: 'intervention-1' })],
        session: expect.objectContaining({
          session_id: 'session-1',
          status: 'open',
          messages: [expect.objectContaining({ id: 'message-1' })],
        }),
      }),
    );
    expect(result.live_console).toEqual(
      expect.objectContaining({
        items: [{ item_id: 'console-1' }],
      }),
    );
    expect(result.history).toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ item_id: 'history-1' })],
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
          expect.objectContaining({ kind: 'approve_task', label: 'Approve' }),
          expect.objectContaining({ kind: 'reject_task', label: 'Reject', prompt_kind: 'feedback' }),
          expect.objectContaining({ kind: 'request_changes_task', label: 'Request changes', prompt_kind: 'feedback' }),
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
            target: {
              target_kind: 'task',
              target_id: '771908c8-0634-467a-b41d-6dd4a6798d7d',
            },
          }),
        ],
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
    expect(result.bottom_tabs.default_tab).toBe('needs_action');
  });

  it('does not treat generic workflow quick actions as needs-action items', async () => {
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
    expect(result.bottom_tabs.default_tab).toBe('needs_action');
  });

  it('includes blocker detail in needs-action summaries and falls back to workflow output descriptors for deliverables', async () => {
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
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1');

    expect(result.needs_action.items).toEqual([
      expect.objectContaining({
        action_kind: 'unblock_work_item',
        summary: 'Review final approval packet is blocked: Waiting on legal sign-off before launch packaging can start.',
      }),
    ]);
    expect(result.deliverables.in_progress_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'artifact:1',
        title: 'artifact:workflow/release-packet.md',
      }),
    ]);
    expect(result.history.items).toEqual([]);
    expect(result.bottom_tabs.counts.deliverables).toBe(1);
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
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_work_item',
      workItemId: 'work-item-1',
    });

    expect(result.deliverables.in_progress_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'artifact:matching',
        work_item_id: 'work-item-1',
      }),
    ]);
    expect(result.deliverables.in_progress_deliverables).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ descriptor_id: 'artifact:other' })]),
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
      taskId: 'task-1',
      tabScope: 'selected_task',
    });

    expect(result.live_console.items.map((item) => item.item_id)).toEqual(['task-linked']);
    expect(result.history.items.map((item) => item.item_id)).toEqual(['history-task']);
    expect(result.history.groups).toEqual([
      expect.objectContaining({
        item_ids: ['history-task'],
      }),
    ]);
    expect(result.bottom_tabs.counts.live_console_activity).toBe(1);
    expect(result.bottom_tabs.counts.history).toBe(1);
  });
});
