import { vi } from 'vitest';

import { TaskLifecycleService } from '../../../src/services/task-lifecycle/task-lifecycle-service.js';

export const identity = {
  id: 'admin',
  tenantId: 'tenant-1',
  scope: 'admin' as const,
  ownerType: 'user',
  ownerId: null,
  keyPrefix: 'admin',
};

export type ReopenScenario = {
  taskId: string;
  feedback: string;
  workflowState: 'paused' | 'active' | 'cancelled';
  workflowMetadata: Record<string, unknown>;
  completedAt: Date | null;
  reopenColumnId: string;
  engagedTaskCount: number;
};

export function createReopenScenarioClient(scenario: ReopenScenario) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('UPDATE tasks SET')) {
        return {
          rowCount: 1,
          rows: [{
            id: scenario.taskId,
            state: 'ready',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            role: 'developer',
            title: 'Implement change',
            is_orchestrator_task: false,
            input: { assessment_feedback: scenario.feedback },
            metadata: { assessment_action: 'request_changes' },
            rework_count: 1,
            completed_at: null,
          }],
        };
      }
      if (
        sql.includes('FROM workflow_work_items wi')
        && sql.includes('JOIN workflows w')
        && sql.includes('JOIN playbooks p')
      ) {
        return {
          rowCount: 1,
          rows: [{
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            stage_name: 'implementation',
            column_id: 'done',
            completed_at: scenario.completedAt,
            workflow_state: scenario.workflowState,
            workflow_metadata: scenario.workflowMetadata,
            definition: {
              roles: ['developer', 'reviewer'],
              lifecycle: 'planned',
              board: {
                columns: [
                  { id: 'planned', label: 'Planned' },
                  { id: 'active', label: 'In Progress' },
                  { id: 'done', label: 'Done', is_terminal: true },
                ],
              },
              stages: [
                { name: 'implementation', goal: 'Implement the change' },
                { name: 'review', goal: 'Review the change' },
              ],
            },
          }],
        };
      }
      if (
        sql.includes('UPDATE workflow_work_items')
        && sql.includes('SET column_id = $4')
        && sql.includes('completed_at = NULL')
        && sql.includes('id = $3')
        && sql.includes('(completed_at IS NOT NULL OR column_id = $5)')
      ) {
        return {
          rowCount: 1,
          rows: [{ id: 'work-item-1' }],
        };
      }
      if (
        sql.includes('UPDATE workflow_output_descriptors')
        && sql.includes("SET state = 'superseded'")
        && sql.includes('work_item_id = $3')
      ) {
        return {
          rowCount: 1,
          rows: [{ id: 'descriptor-1' }],
        };
      }
      if (sql.includes('UPDATE workflow_work_items') && sql.includes('parent_work_item_id = $3')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('SELECT playbook_id FROM workflows')) {
        return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO workflow_activations')) {
        return {
          rowCount: 1,
          rows: [{
            id: `activation-${scenario.taskId}`,
            workflow_id: 'workflow-1',
            activation_id: null,
            request_id: `task-assessment-requested:${scenario.taskId}:Sat Mar 21 2026 02:10:00 GMT+0000 (Coordinated Universal Time)`,
            reason: 'task.assessment_requested_changes',
            event_type: 'task.assessment_requested_changes',
            payload: { task_id: scenario.taskId },
            state: 'queued',
            dispatch_attempt: 0,
            dispatch_token: null,
            queued_at: new Date('2026-03-21T02:10:00Z'),
            started_at: null,
            consumed_at: null,
            completed_at: null,
            summary: null,
            error: null,
          }],
        };
      }
      if (sql.includes('COUNT(*)::int AS engaged_task_count')) {
        return { rows: [{ engaged_task_count: scenario.engagedTaskCount }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
}

export function createTaskLifecycleService(client: ReturnType<typeof createReopenScenarioClient>) {
  return new TaskLifecycleService({
    pool: { connect: vi.fn(async () => client) } as never,
    eventService: { emit: vi.fn() } as never,
    workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
    defaultTaskTimeoutMinutes: 30,
    loadTaskOrThrow: vi.fn().mockResolvedValue({
      id: 'task-reopen',
      state: 'completed',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      stage_name: 'implementation',
      role: 'developer',
      title: 'Implement change',
      is_orchestrator_task: false,
      input: { summary: 'already shipped once' },
      rework_count: 0,
      completed_at: '2026-03-20T20:00:00.000Z',
      metadata: {},
    }),
    toTaskResponse: (task) => task,
    workItemContinuityService: { recordAssessmentRequestedChanges: vi.fn() } as never,
  });
}
