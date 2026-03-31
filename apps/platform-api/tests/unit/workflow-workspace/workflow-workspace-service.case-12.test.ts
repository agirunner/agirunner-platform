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

});
