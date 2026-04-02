import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: vi.fn(),
}));

vi.mock('../../../src/services/workflow-stage/workflow-stage-reconciliation.js', () => ({
  reconcilePlannedWorkflowStages: vi.fn(async () => undefined),
}));

vi.mock('../../../src/services/document-reference/document-reference-service.js', () => ({
  registerTaskOutputDocuments: vi.fn(async () => undefined),
}));

import { TaskLifecycleService } from '../../../src/services/task-lifecycle/task-lifecycle-service.js';

describe('TaskLifecycleService planned work item auto-close', () => {
  it('rechecks planned predecessor auto-close when an orchestrator task is the final open task', async () => {
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('SELECT id') && sql.includes('FROM workflows') && sql.includes('FOR UPDATE')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.includes('SELECT w.live_visibility_mode_override')) {
          return {
            rowCount: 1,
            rows: [{
              live_visibility_mode_override: 'standard',
              activation_id: 'activation-1',
              is_orchestrator_task: true,
            }],
          };
        }
        if (sql.includes('SELECT live_visibility_mode_default')) {
          return {
            rowCount: 1,
            rows: [{ live_visibility_mode_default: 'standard' }],
          };
        }
        if (sql.includes('FROM workflow_operator_briefs')) {
          return {
            rowCount: 1,
            rows: [{ id: 'brief-1' }],
          };
        }
        if (sql.startsWith('UPDATE tasks SET') && sql.includes('RETURNING *')) {
          expect(values?.[0]).toBe('tenant-1');
          expect(values?.[1]).toBe('orch-task-1');
          expect(values?.[2]).toBe('completed');
          return {
            rowCount: 1,
            rows: [{
              id: 'orch-task-1',
              state: 'completed',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-review-1',
              is_orchestrator_task: true,
              assigned_agent_id: null,
              assigned_worker_id: null,
              role: 'orchestrator',
              stage_name: 'review',
              output: { summary: 'Requested rework and opened a follow-up review pass.' },
              metadata: {},
            }],
          };
        }
        if (sql.startsWith('UPDATE agents')) {
          expect(values).toEqual(['tenant-1', 'agent-1']);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT w.lifecycle, p.definition')) {
          return {
            rowCount: 1,
            rows: [{
              lifecycle: 'planned',
              definition: {
                process_instructions: 'Route review outcomes and close review work once follow-up is created.',
                roles: ['Software Developer', 'Code Reviewer', 'Security Reviewer'],
                stages: [
                  { name: 'reproduce', goal: 'Reproduce the bug.' },
                  { name: 'implement', goal: 'Implement the fix.' },
                  { name: 'review', goal: 'Review the fix.' },
                ],
                board: {
                  entry_column_id: 'active',
                  columns: [
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
              },
            }],
          };
        }
        if (sql.includes('SELECT wi.stage_name') && sql.includes('JOIN workflow_stages ws')) {
          return {
            rowCount: 1,
            rows: [{
              stage_name: 'review',
              column_id: 'active',
              completed_at: null,
              gate_status: 'not_requested',
              blocked_state: null,
              escalation_status: null,
              next_expected_actor: null,
              next_expected_action: null,
            }],
          };
        }
        if (sql.includes('SELECT COUNT(*)::int AS count')) {
          return {
            rowCount: 1,
            rows: [{ count: 0 }],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          return {
            rowCount: 0,
            rows: [],
          };
        }
        if (sql.includes('SELECT th.completion_callouts')) {
          return {
            rowCount: 1,
            rows: [{
              completion_callouts: {
                follow_up: 'Implement stage was reopened for requested changes.',
              },
            }],
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(values).toEqual([
            'tenant-1',
            'workflow-1',
            'work-item-review-1',
            'done',
            expect.any(Date),
            { follow_up: 'Implement stage was reopened for requested changes.' },
          ]);
          return {
            rowCount: 1,
            rows: [{ id: 'work-item-review-1' }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: eventService as never,
      workflowStateService: {
        recomputeWorkflowState: vi.fn(async () => undefined),
      } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'orch-task-1',
        state: 'in_progress',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-review-1',
        is_orchestrator_task: true,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role: 'orchestrator',
        stage_name: 'review',
        role_config: {},
        output: null,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
    });

    const result = await service.completeTask(
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'ak',
      },
      'orch-task-1',
      { output: { summary: 'Requested rework and opened a follow-up review pass.' } },
      client as never,
    );

    expect(result.state).toBe('completed');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.completed',
        entityId: 'work-item-review-1',
        data: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-review-1',
          stage_name: 'review',
          column_id: 'done',
        }),
      }),
      client,
    );
  });
});
