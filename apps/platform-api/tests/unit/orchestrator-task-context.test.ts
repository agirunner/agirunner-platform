import { describe, expect, it, vi } from 'vitest';

import { buildOrchestratorTaskContext } from '../../src/services/orchestrator-task-context.js';

describe('buildOrchestratorTaskContext', () => {
  it('derives active stages from open work items only for continuous workflows', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows w')) {
          return {
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              lifecycle: 'ongoing',
              metadata: {},
              playbook_name: 'Continuous Flow',
              playbook_outcome: 'Ship work',
              playbook_definition: {
                board: { columns: [{ id: 'todo', label: 'Todo' }] },
                stages: [
                  { name: 'triage', goal: 'Sort incoming work' },
                  { name: 'implementation', goal: 'Implement work' },
                  { name: 'review', goal: 'Review work' },
                ],
                lifecycle: 'ongoing',
              },
            }],
          };
        }
        if (sql.includes('FROM workflow_activations')) {
          return {
            rows: [
              {
                id: 'activation-1',
                activation_id: 'activation-1',
                reason: 'work_item.created',
                event_type: 'work_item.created',
                payload: { work_item_id: 'wi-1' },
                state: 'processing',
                dispatch_attempt: 2,
                dispatch_token: 'dispatch-token-1',
                queued_at: new Date('2026-03-11T00:00:00Z'),
                started_at: new Date('2026-03-11T00:00:05Z'),
                consumed_at: null,
                completed_at: null,
                summary: null,
                error: null,
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_stages')) {
          return {
            rows: [
              {
                id: 'stage-1',
                lifecycle: 'ongoing',
                name: 'triage',
                position: 0,
                goal: 'Sort incoming work',
                guidance: null,
                human_gate: false,
                status: 'pending',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 2,
                total_work_item_count: 2,
                first_work_item_at: new Date('2026-03-11T00:00:00Z'),
                last_completed_work_item_at: null,
              },
              {
                id: 'stage-2',
                lifecycle: 'ongoing',
                name: 'review',
                position: 2,
                goal: 'Review work',
                guidance: null,
                human_gate: true,
                status: 'pending',
                gate_status: 'awaiting_approval',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 0,
                first_work_item_at: null,
                last_completed_work_item_at: null,
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_work_items')) {
          return {
            rows: [
              {
                id: 'wi-1',
                stage_name: 'implementation',

                next_expected_actor: 'reviewer',
                next_expected_action: 'assess',
                rework_count: 1,
                completed_at: null,
              },
              {
                id: 'wi-2',
                stage_name: 'triage',

                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                completed_at: null,
              },
              {
                id: 'wi-3',
                stage_name: 'triage',

                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                completed_at: null,
              },
              {
                id: 'wi-4',
                stage_name: 'done',

                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                completed_at: '2026-03-11T00:00:00.000Z',
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildOrchestratorTaskContext(db as never, 'tenant-1', {
      id: 'task-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: true,
      activation_id: 'activation-1',
    });

    expect(context?.workflow).toEqual(
      expect.objectContaining({
        lifecycle: 'ongoing',
        active_stages: ['triage', 'implementation'],
      }),
    );
    expect(context?.workflow).not.toHaveProperty('current_stage');
    expect(context?.board.stages).toEqual([
      expect.objectContaining({
        name: 'triage',
        status: 'active',
        is_active: true,
        open_work_item_count: 2,
        total_work_item_count: 2,
      }),
      expect.objectContaining({
        name: 'review',
        status: 'awaiting_gate',
        is_active: true,
        gate_status: 'awaiting_approval',
        open_work_item_count: 0,
        total_work_item_count: 0,
      }),
    ]);
    expect(context?.activation).toEqual(
      expect.objectContaining({
        dispatch_attempt: 2,
        dispatch_token: 'dispatch-token-1',
      }),
    );
    expect(context?.board.work_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'wi-1',
          stage_name: 'implementation',
          next_expected_actor: 'reviewer',
          next_expected_action: 'assess',
          rework_count: 1,
        }),
      ]),
    );
    expect(context?.board.work_items[0]).not.toHaveProperty('current_checkpoint');
  });

  it('surfaces the latest activation checkpoint from task metadata', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows w')) {
          return {
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              lifecycle: 'planned',
              metadata: {},
              playbook_name: 'Linear Flow',
              playbook_outcome: 'Ship work',
              playbook_definition: {
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                stages: [{ name: 'implementation', goal: 'Build the work' }],
              },
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    const context = await buildOrchestratorTaskContext(db as never, 'tenant-1', {
      id: 'task-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: true,
      metadata: {
        last_activation_checkpoint: {
          activation_id: 'activation-7',
          current_working_state: 'waiting on review',
          recent_memory_keys: ['decision_log'],
        },
      },
    });

    expect(context?.last_activation_checkpoint).toEqual({
      activation_id: 'activation-7',
      current_working_state: 'waiting on review',
      recent_memory_keys: ['decision_log'],
    });
  });

  it('builds closure context with controls, recovery outcomes, and attempt history', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w')) {
          return {
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              lifecycle: 'planned',
              metadata: {},
              playbook_name: 'Linear Flow',
              playbook_outcome: 'Ship work',
              playbook_definition: {
                board: { columns: [{ id: 'planned', label: 'Planned' }, { id: 'done', label: 'Done', is_terminal: true }] },
                lifecycle: 'planned',
                stages: [{ name: 'review', goal: 'Review the work', involves: ['reviewer', 'brand-reviewer'] }],
              },
            }],
          };
        }
        if (sql.includes('FROM workflow_activations')) {
          return { rows: [] };
        }
        if (sql.includes('FROM workflow_work_items')) {
          return {
            rows: [
              {
                id: 'wi-1',
                parent_work_item_id: null,
                stage_name: 'review',
                title: 'Review the change',
                goal: 'Review the work',
                column_id: 'planned',
                owner_role: 'reviewer',
                next_expected_actor: 'reviewer',
                next_expected_action: 'approve',
                rework_count: 1,
                priority: 'normal',
                completed_at: null,
                notes: null,
                metadata: {},
                current_subject_revision: 2,
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_stages')) {
          return {
            rows: [{
              id: 'stage-review',
              lifecycle: 'planned',
              name: 'review',
              position: 0,
              goal: 'Review the work',
              guidance: null,
              human_gate: false,
              status: 'active',
              gate_status: 'not_requested',
              iteration_count: 0,
              summary: null,
              started_at: null,
              completed_at: null,
              open_work_item_count: 1,
              total_work_item_count: 1,
              first_work_item_at: null,
              last_completed_work_item_at: null,
            }],
          };
        }
        if (sql.includes('FROM tasks')) {
          return {
            rows: [
              {
                id: 'task-review-1',
                title: 'Review the change',
                role: 'reviewer',
                state: 'completed',
                work_item_id: 'wi-1',
                stage_name: 'review',
                activation_id: null,
                assigned_agent_id: null,
                claimed_at: null,
                started_at: '2026-03-24T10:00:00.000Z',
                completed_at: '2026-03-24T10:05:00.000Z',
                is_orchestrator_task: false,
                input: { subject_revision: 2 },
                metadata: { task_kind: 'assessment' },
                retry_count: 0,
                rework_count: 0,
                error: null,
              },
              {
                id: 'task-brand-1',
                title: 'Brand review',
                role: 'brand-reviewer',
                state: 'failed',
                work_item_id: 'wi-1',
                stage_name: 'review',
                activation_id: null,
                assigned_agent_id: null,
                claimed_at: null,
                started_at: '2026-03-24T10:06:00.000Z',
                completed_at: '2026-03-24T10:08:00.000Z',
                is_orchestrator_task: false,
                input: {},
                metadata: {
                  retry_available_at: '2026-03-24T10:15:00.000Z',
                  retry_backoff_seconds: 60,
                  retry_last_error: 'workspace dependency missing',
                },
                retry_count: 1,
                rework_count: 0,
                error: { message: 'workspace dependency missing' },
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_stage_gates')) {
          return { rows: [] };
        }
        if (sql.includes('FROM workflow_subject_escalations')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          return {
            rows: [{
              id: 'esc-1',
              work_item_id: 'wi-1',
              reason: 'Editorial escalation remains advisory.',
              closure_effect: 'advisory',
            }],
          };
        }
        if (sql.includes('FROM workflow_tool_results')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          return {
            rows: [{
              mutation_outcome: 'recoverable_not_applied',
              recovery_class: 'predecessor_missing_handoff',
              response: {
                suggested_next_actions: [
                  {
                    action_code: 'rerun_predecessor_for_handoff',
                    target_type: 'task',
                    target_id: 'task-review-0',
                    why: 'the predecessor task exited without a full handoff',
                    requires_orchestrator_judgment: true,
                  },
                ],
              },
            }],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildOrchestratorTaskContext(db as never, 'tenant-1', {
      id: 'task-orchestrator-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: true,
      work_item_id: 'wi-1',
    });

    expect(context?.closure_context).toEqual({
      workflow_can_close_now: false,
      work_item_can_close_now: true,
      active_blocking_controls: [],
      active_advisory_controls: [
        {
          kind: 'escalation',
          id: 'esc-1',
          closure_effect: 'advisory',
          summary: 'Editorial escalation remains advisory.',
        },
      ],
      preferred_obligations: [
        {
          code: 'stage_role_contribution',
          status: 'unmet',
          subject: 'brand-reviewer',
        },
      ],
      closure_readiness: 'can_close_with_callouts',
      recent_recovery_outcomes: [
        {
          recovery_class: 'predecessor_missing_handoff',
          suggested_next_actions: [
            {
              action_code: 'rerun_predecessor_for_handoff',
              target_type: 'task',
              target_id: 'task-review-0',
              why: 'the predecessor task exited without a full handoff',
              requires_orchestrator_judgment: true,
            },
          ],
        },
      ],
      attempt_count_by_work_item: { 'wi-1': 2 },
      attempt_count_by_role: { reviewer: 1, 'brand-reviewer': 1 },
      recent_failures: [
        {
          task_id: 'task-brand-1',
          role: 'brand-reviewer',
          state: 'failed',
          why: 'workspace dependency missing',
        },
      ],
      last_retry_reason: 'workspace dependency missing',
      retry_window: {
        retry_available_at: '2026-03-24T10:15:00.000Z',
        backoff_seconds: 60,
      },
      reroute_candidates: ['brand-reviewer'],
    });
  });

  it('adds dynamic playbook role definitions with names and descriptions', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w')) {
          return {
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              lifecycle: 'planned',
              metadata: {},
              playbook_name: 'Linear Flow',
              playbook_outcome: 'Ship work',
              playbook_definition: {
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                roles: ['product-manager', 'architect', 'reviewer'],
                stages: [{ name: 'requirements', goal: 'Define the work' }],
              },
            }],
          };
        }
        if (sql.includes('FROM role_definitions')) {
          expect(params?.[1]).toEqual(['product-manager', 'architect', 'reviewer']);
          return {
            rows: [
              { name: 'product-manager', description: 'Owns scope and acceptance.' },
              { name: 'architect', description: 'Designs the technical approach.' },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildOrchestratorTaskContext(db as never, 'tenant-1', {
      id: 'task-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: true,
    });

    expect(context?.workflow.role_definitions).toEqual([
      {
        name: 'product-manager',
        description: 'Owns scope and acceptance.',
      },
      {
        name: 'architect',
        description: 'Designs the technical approach.',
      },
      {
        name: 'reviewer',
        description: null,
      },
    ]);
  });

  it('derives pending specialist dispatches for open work items that have no open matching task', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows w')) {
          return {
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              lifecycle: 'planned',
              metadata: {},
              playbook_name: 'Linear Flow',
              playbook_outcome: 'Ship work',
              playbook_definition: {
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                lifecycle: 'planned',
                stages: [
                  { name: 'implementation', goal: 'Build the work' },
                  { name: 'review', goal: 'Review the work' },
                ],
              },
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items')) {
          return {
            rows: [
              {
                id: 'implementation-item',
                parent_work_item_id: null,
                stage_name: 'implementation',
                title: 'Implement the change',
                goal: 'Build the work',
                column_id: 'planned',
                owner_role: 'developer',
                next_expected_actor: 'developer',
                next_expected_action: 'rework',
                rework_count: 2,
                priority: 'normal',
                completed_at: null,
                notes: null,
                metadata: {},
              },
              {
                id: 'review-item',
                parent_work_item_id: 'implementation-item',
                stage_name: 'review',
                title: 'Review the change',
                goal: 'Review the work',
                column_id: 'planned',
                owner_role: 'reviewer',
                next_expected_actor: 'reviewer',
                next_expected_action: 'assess',
                rework_count: 0,
                priority: 'normal',
                completed_at: null,
                notes: null,
                metadata: {},
              },
            ],
          };
        }
        if (sql.includes('FROM tasks')) {
          return {
            rows: [
              {
                id: 'developer-task',
                title: 'Implement the change',
                role: 'developer',
                state: 'output_pending_assessment',
                work_item_id: 'implementation-item',
                stage_name: 'implementation',
                activation_id: null,
                assigned_agent_id: null,
                claimed_at: null,
                started_at: null,
                completed_at: null,
                is_orchestrator_task: false,
              },
              {
                id: 'review-task-1',
                title: 'First review pass',
                role: 'reviewer',
                state: 'completed',
                work_item_id: 'review-item',
                stage_name: 'review',
                activation_id: null,
                assigned_agent_id: null,
                claimed_at: null,
                started_at: null,
                completed_at: '2026-03-21T13:10:00.000Z',
                is_orchestrator_task: false,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildOrchestratorTaskContext(db as never, 'tenant-1', {
      id: 'task-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: true,
    });

    expect(context?.board.pending_dispatches).toEqual([
      expect.objectContaining({
        work_item_id: 'review-item',
        stage_name: 'review',
        actor: 'reviewer',
        action: 'assess',
      }),
    ]);
  });

  it('suppresses parent review dispatches when an open child review work item already owns the review loop', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows w')) {
          return {
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              lifecycle: 'planned',
              metadata: {},
              playbook_name: 'Linear Flow',
              playbook_outcome: 'Ship work',
              playbook_definition: {
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                lifecycle: 'planned',
                stages: [
                  { name: 'implementation', goal: 'Build the work' },
                  { name: 'review', goal: 'Review the work' },
                ],
              },
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items')) {
          return {
            rows: [
              {
                id: 'implementation-item',
                parent_work_item_id: null,
                stage_name: 'implementation',
                title: 'Implement the change',
                goal: 'Build the work',
                column_id: 'planned',
                owner_role: 'developer',
                next_expected_actor: 'reviewer',
                next_expected_action: 'assess',
                rework_count: 1,
                priority: 'normal',
                completed_at: null,
                notes: null,
                metadata: {},
              },
              {
                id: 'review-item',
                parent_work_item_id: 'implementation-item',
                stage_name: 'review',
                title: 'Review the change',
                goal: 'Review the work',
                column_id: 'planned',
                owner_role: 'reviewer',
                next_expected_actor: 'reviewer',
                next_expected_action: 'assess',
                rework_count: 0,
                priority: 'normal',
                completed_at: null,
                notes: null,
                metadata: {},
              },
            ],
          };
        }
        if (sql.includes('FROM tasks')) {
          return {
            rows: [
              {
                id: 'developer-task',
                title: 'Implement the change',
                role: 'developer',
                state: 'output_pending_assessment',
                work_item_id: 'implementation-item',
                stage_name: 'implementation',
                activation_id: null,
                assigned_agent_id: null,
                claimed_at: null,
                started_at: null,
                completed_at: null,
                is_orchestrator_task: false,
              },
              {
                id: 'review-task-1',
                title: 'First review pass',
                role: 'reviewer',
                state: 'completed',
                work_item_id: 'review-item',
                stage_name: 'review',
                activation_id: null,
                assigned_agent_id: null,
                claimed_at: null,
                started_at: null,
                completed_at: '2026-03-21T13:10:00.000Z',
                is_orchestrator_task: false,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildOrchestratorTaskContext(db as never, 'tenant-1', {
      id: 'task-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: true,
    });

    expect(context?.board.pending_dispatches).toEqual([
      expect.objectContaining({
        work_item_id: 'review-item',
        stage_name: 'review',
        actor: 'reviewer',
        action: 'assess',
      }),
    ]);
  });

  it('derives pending assessor dispatches from actual continuity actor state', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows w')) {
          return {
            rows: [{
              id: 'workflow-1',
              name: 'Workflow One',
              lifecycle: 'planned',
              metadata: {},
              playbook_name: 'Linear Flow',
              playbook_outcome: 'Ship work',
              playbook_definition: {
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                lifecycle: 'planned',
                roles: ['feature-engineer', 'security-assessor', 'qa-assessor'],
                stages: [
                  { name: 'implementation-pass', goal: 'Build the work' },
                ],
              },
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items')) {
          return {
            rows: [
              {
                id: 'implementation-item',
                parent_work_item_id: null,
                stage_name: 'implementation-pass',
                title: 'Implement the release guardrails',
                goal: 'Build the work',
                column_id: 'planned',
                owner_role: 'feature-engineer',
                next_expected_actor: 'qa-assessor',
                next_expected_action: 'assess',
                rework_count: 1,
                priority: 'normal',
                completed_at: null,
                notes: null,
                metadata: {},
              },
            ],
          };
        }
        if (sql.includes('FROM tasks')) {
          return {
            rows: [
              {
                id: 'delivery-task-3',
                title: 'Implement revision 3',
                role: 'feature-engineer',
                state: 'output_pending_assessment',
                work_item_id: 'implementation-item',
                stage_name: 'implementation-pass',
                activation_id: null,
                assigned_agent_id: null,
                claimed_at: null,
                started_at: null,
                completed_at: null,
                is_orchestrator_task: false,
                input: { subject_revision: 3 },
                metadata: { task_kind: 'delivery', subject_revision: 3 },
              },
              {
                id: 'security-assessment-3',
                title: 'Security review revision 3',
                role: 'security-assessor',
                state: 'completed',
                work_item_id: 'implementation-item',
                stage_name: 'implementation-pass',
                activation_id: null,
                assigned_agent_id: null,
                claimed_at: null,
                started_at: null,
                completed_at: '2026-03-23T19:55:00.000Z',
                is_orchestrator_task: false,
                input: {},
                metadata: { task_kind: 'assessment' },
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildOrchestratorTaskContext(db as never, 'tenant-1', {
      id: 'task-1',
      workflow_id: 'workflow-1',
      is_orchestrator_task: true,
    });

    expect(context?.board.pending_dispatches).toEqual([
      expect.objectContaining({
        work_item_id: 'implementation-item',
        stage_name: 'implementation-pass',
        actor: 'qa-assessor',
        action: 'assess',
      }),
    ]);
  });
});
