import { beforeEach, describe, expect, it } from 'vitest';

import { createPool, createService } from './support.js';

describe('WorkflowOperatorUpdateService listUpdates', () => {
  let pool: ReturnType<typeof createPool>;
  let service: ReturnType<typeof createService>;

  beforeEach(() => {
    pool = createPool();
    service = createService(pool);
  });

  it('lists operator updates newest first with optional work-item filtering', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows') && sql.includes('SELECT id, live_visibility_mode_override')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            live_visibility_mode_override: 'enhanced',
            live_visibility_revision: 2,
            live_visibility_updated_by_operator_id: 'user-1',
            live_visibility_updated_at: new Date('2026-03-27T16:00:00.000Z'),
          }],
        };
      }
      if (sql.includes('FROM workflow_operator_updates')) {
        expect(params).toEqual([
          'tenant-1',
          'workflow-1',
          'work-item-1',
          'work-item-1',
          null,
          null,
          2,
        ]);
        return {
          rowCount: 2,
          rows: [
            {
              id: 'update-2',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              task_id: null,
              request_id: 'request-2',
              execution_context_id: 'execution-2',
              source_kind: 'orchestrator',
              source_role_name: 'Orchestrator',
              update_kind: 'turn_update',
              headline: 'Newer update',
              summary: 'Still progressing.',
              linked_target_ids: ['work-item-1'],
              visibility_mode: 'enhanced',
              promoted_brief_id: null,
              sequence_number: 12,
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: new Date('2026-03-27T18:00:00.000Z'),
            },
            {
              id: 'update-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              task_id: null,
              request_id: 'request-1',
              execution_context_id: 'execution-1',
              source_kind: 'specialist',
              source_role_name: 'Verifier',
              update_kind: 'turn_update',
              headline: 'Older update',
              summary: 'Validation started.',
              linked_target_ids: ['work-item-1'],
              visibility_mode: 'enhanced',
              promoted_brief_id: null,
              sequence_number: 11,
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: new Date('2026-03-27T17:00:00.000Z'),
            },
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.listUpdates('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      limit: 2,
    });

    expect(result.map((entry) => entry.id)).toEqual(['update-2', 'update-1']);
  });

  it('includes linked-target workflow updates when a scoped task or work item is selected', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows') && sql.includes('SELECT id, live_visibility_mode_override')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            live_visibility_mode_override: 'enhanced',
            live_visibility_revision: 2,
            live_visibility_updated_by_operator_id: 'user-1',
            live_visibility_updated_at: new Date('2026-03-27T16:00:00.000Z'),
          }],
        };
      }
      if (sql.includes('FROM workflow_operator_updates')) {
        expect(sql).toContain('linked_target_ids @>');
        expect(params).toEqual([
          'tenant-1',
          'workflow-1',
          'work-item-7',
          'work-item-7',
          'task-4',
          'task-4',
          5,
        ]);
        return {
          rowCount: 1,
          rows: [
            {
              id: 'update-linked',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: null,
              task_id: null,
              request_id: 'request-linked',
              execution_context_id: 'activation-1',
              source_kind: 'orchestrator',
              source_role_name: 'Orchestrator',
              update_kind: 'turn_update',
              headline: 'Linked update',
              summary: 'Still relevant to the selected task.',
              linked_target_ids: ['workflow-1', 'work-item-7', 'task-4'],
              visibility_mode: 'enhanced',
              promoted_brief_id: null,
              sequence_number: 13,
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: new Date('2026-03-27T19:05:00.000Z'),
            },
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.listUpdates('tenant-1', 'workflow-1', {
      workItemId: 'work-item-7',
      taskId: 'task-4',
      limit: 5,
    });

    expect(result.map((entry) => entry.id)).toEqual(['update-linked']);
  });

  it('keeps task scope narrow while preserving persisted orchestrator updates linked to the task', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows') && sql.includes('SELECT id, live_visibility_mode_override')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            live_visibility_mode_override: 'enhanced',
            live_visibility_revision: 2,
            live_visibility_updated_by_operator_id: 'user-1',
            live_visibility_updated_at: new Date('2026-03-27T16:00:00.000Z'),
          }],
        };
      }
      if (sql.includes('FROM workflow_operator_updates')) {
        return {
          rowCount: 2,
          rows: [
            {
              id: 'update-work-item',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-7',
              task_id: null,
              request_id: 'request-work-item',
              execution_context_id: 'task-7',
              source_kind: 'specialist',
              source_role_name: 'Verifier',
              update_kind: 'turn_update',
              headline: 'Work-item update',
              summary: 'Only linked to the work item.',
              linked_target_ids: ['workflow-1', 'work-item-7'],
              visibility_mode: 'enhanced',
              promoted_brief_id: null,
              sequence_number: 13,
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: new Date('2026-03-27T19:04:00.000Z'),
            },
            {
              id: 'update-task-linked',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: null,
              task_id: null,
              request_id: 'request-task-linked',
              execution_context_id: 'activation-1',
              source_kind: 'orchestrator',
              source_role_name: 'Orchestrator',
              update_kind: 'turn_update',
              headline: 'Persisted task-linked update',
              summary: 'Still relevant to the selected task.',
              linked_target_ids: ['workflow-1', 'work-item-7', 'task-4'],
              visibility_mode: 'enhanced',
              promoted_brief_id: null,
              sequence_number: 14,
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: new Date('2026-03-27T19:05:00.000Z'),
            },
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.listUpdates('tenant-1', 'workflow-1', {
      workItemId: 'work-item-7',
      taskId: 'task-4',
      limit: 5,
    });

    expect(result.map((entry) => entry.id)).toEqual(['update-task-linked']);
  });
});
