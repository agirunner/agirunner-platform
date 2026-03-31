import { describe, expect, it, vi } from 'vitest';

import { buildOrchestratorTaskContext } from '../../../src/services/orchestrator-task-context/orchestrator-task-context.js';

describe('buildOrchestratorTaskContext', () => {
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
