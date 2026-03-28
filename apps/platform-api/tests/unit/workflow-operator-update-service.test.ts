import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkflowOperatorUpdateService } from '../../src/services/workflow-operator-update-service.js';

const IDENTITY = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'user',
  ownerId: 'user-1',
  keyPrefix: 'admin',
} as const;

function createPool() {
  return {
    query: vi.fn(),
  };
}

describe('WorkflowOperatorUpdateService', () => {
  let pool: ReturnType<typeof createPool>;
  let service: WorkflowOperatorUpdateService;

  beforeEach(() => {
    pool = createPool();
    service = new WorkflowOperatorUpdateService(pool as never);
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
        expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1', 2]);
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

  it('records nested operator update payloads and derives visibility mode from workflow settings', async () => {
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
      if (sql.includes('FROM tasks')) {
        expect(params).toEqual([
          'tenant-1',
          'workflow-1',
          'task-9',
          ['claimed', 'in_progress', 'output_pending_assessment', 'awaiting_approval'],
        ]);
        return {
          rowCount: 1,
          rows: [{
            id: 'task-9',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            is_orchestrator_task: false,
            role: 'Verifier',
            state: 'in_progress',
          }],
        };
      }
      if (sql.includes('FROM workflow_operator_updates') && sql.includes('request_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_work_items')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
        return { rowCount: 1, rows: [{ id: 'work-item-1' }] };
      }
      if (sql.includes('COALESCE(MAX(sequence_number), 0) + 1')) {
        return { rowCount: 1, rows: [{ next_sequence: 9 }] };
      }
      if (sql.includes('INSERT INTO workflow_operator_updates')) {
        expect(params?.[9]).toBe('Verification is reviewing rollback handling.');
        expect(params?.[10]).toBe('redacted://workflow-update-secret');
        expect(params?.[11]).toEqual(['work-item-1', 'task-9']);
        expect(params?.[12]).toBe('enhanced');
        return {
          rowCount: 1,
          rows: [{
            id: 'update-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-9',
            request_id: 'request-1',
            execution_context_id: 'task-9',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            update_kind: 'turn_update',
            headline: 'Verification is reviewing rollback handling.',
            summary: 'redacted://workflow-update-secret',
            linked_target_ids: ['work-item-1', 'task-9'],
            visibility_mode: 'enhanced',
            promoted_brief_id: null,
            sequence_number: 9,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-27T17:00:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordUpdateWrite(IDENTITY as never, 'workflow-1', {
      requestId: 'request-1',
      executionContextId: 'task-9',
      workItemId: 'work-item-1',
      taskId: 'task-9',
      sourceKind: 'specialist',
      sourceRoleName: 'Verifier',
      payload: {
        updateKind: 'turn_update',
        headline: 'Verification is reviewing rollback handling.',
        summary: 'Bearer hidden',
        linkedTargetIds: ['work-item-1', 'task-9'],
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        record_id: 'update-1',
        sequence_number: 9,
        deduped: false,
        record: expect.objectContaining({
          id: 'update-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-9',
          visibility_mode: 'enhanced',
          summary: 'redacted://workflow-update-secret',
        }),
      }),
    );
  });

  it('persists workflow-level live visibility overrides prospectively', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows') && sql.includes('SELECT id, live_visibility_mode_override')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            live_visibility_mode_override: null,
            live_visibility_revision: 2,
            live_visibility_updated_by_operator_id: null,
            live_visibility_updated_at: null,
          }],
        };
      }
      if (sql.includes('UPDATE workflows')) {
        expect(params?.[0]).toBe('standard');
        expect(params?.[1]).toBe('user-1');
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            live_visibility_mode_override: 'standard',
            live_visibility_revision: 3,
            live_visibility_updated_by_operator_id: 'user-1',
            live_visibility_updated_at: new Date('2026-03-27T18:00:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.updateWorkflowLiveVisibilityModeOverride(
      IDENTITY as never,
      'workflow-1',
      'standard',
    );

    expect(result).toEqual({
      workflow_id: 'workflow-1',
      live_visibility_mode_override: 'standard',
      live_visibility_revision: 3,
      live_visibility_updated_by_operator_id: 'user-1',
      live_visibility_updated_at: '2026-03-27T18:00:00.000Z',
    });
  });
});
