import { beforeEach, describe, expect, it } from 'vitest';

import { IDENTITY, createPool, createService } from './support.js';

describe('WorkflowOperatorUpdateService recordUpdateWrite', () => {
  let pool: ReturnType<typeof createPool>;
  let service: ReturnType<typeof createService>;

  beforeEach(() => {
    pool = createPool();
    service = createService(pool);
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
          [
            'claimed',
            'in_progress',
            'output_pending_assessment',
            'awaiting_approval',
            'completed',
            'failed',
            'cancelled',
            'escalated',
          ],
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
        expect(params?.[9]).toBeNull();
        expect(params?.[10]).toBe('Verification is reviewing rollback handling.');
        expect(params?.[11]).toBe('redacted://workflow-update-secret');
        expect(params?.[12]).toBe(JSON.stringify(['work-item-1', 'task-9']));
        expect(params?.[13]).toBe('enhanced');
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
            llm_turn_count: null,
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
          llm_turn_count: null,
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

  it('derives request, source, and update kind defaults when omitted', async () => {
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
        return {
          rowCount: 1,
          rows: [{
            id: 'task-11',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-11',
            is_orchestrator_task: false,
            role: 'Verifier',
            state: 'completed',
          }],
        };
      }
      if (sql.includes('FROM workflow_operator_updates') && sql.includes('request_id = $3')) {
        expect(params?.[2]).toEqual(expect.any(String));
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return { rowCount: 1, rows: [{ id: 'work-item-11' }] };
      }
      if (sql.includes('COALESCE(MAX(sequence_number), 0) + 1')) {
        return { rowCount: 1, rows: [{ next_sequence: 10 }] };
      }
      if (sql.includes('INSERT INTO workflow_operator_updates')) {
        expect(params?.[5]).toEqual(expect.any(String));
        expect(params?.[7]).toBe('specialist');
        expect(params?.[14]).toBe('turn_update');
        return {
          rowCount: 1,
          rows: [{
            id: 'update-10',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-11',
            task_id: 'task-11',
            request_id: params?.[5],
            execution_context_id: 'task-11',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            llm_turn_count: null,
            update_kind: 'turn_update',
            headline: 'Verifier is writing the operator update.',
            summary: null,
            linked_target_ids: [],
            visibility_mode: 'enhanced',
            promoted_brief_id: null,
            sequence_number: 10,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T02:10:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordUpdateWrite(IDENTITY as never, 'workflow-1', {
      executionContextId: 'task-11',
      workItemId: 'work-item-11',
      taskId: 'task-11',
      payload: {
        headline: 'Verifier is writing the operator update.',
      },
    } as never);

    expect(result.record.request_id).toEqual(expect.any(String));
    expect(result.record.source_kind).toBe('specialist');
    expect(result.record.update_kind).toBe('turn_update');
  });

  it('persists llm turn count on recorded operator updates', async () => {
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
        return {
          rowCount: 1,
          rows: [{
            id: 'task-12',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-12',
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
        return { rowCount: 1, rows: [{ id: 'work-item-12' }] };
      }
      if (sql.includes('COALESCE(MAX(sequence_number), 0) + 1')) {
        return { rowCount: 1, rows: [{ next_sequence: 11 }] };
      }
      if (sql.includes('INSERT INTO workflow_operator_updates')) {
        expect(params?.[9]).toBe(7);
        return {
          rowCount: 1,
          rows: [{
            id: 'update-11',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-12',
            task_id: 'task-12',
            request_id: 'request-11',
            execution_context_id: 'task-12',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            llm_turn_count: 7,
            update_kind: 'turn_update',
            headline: 'Verifier is closing the loop.',
            summary: null,
            linked_target_ids: [],
            visibility_mode: 'enhanced',
            promoted_brief_id: null,
            sequence_number: 11,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T02:15:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordUpdateWrite(IDENTITY as never, 'workflow-1', {
      requestId: 'request-11',
      executionContextId: 'task-12',
      workItemId: 'work-item-12',
      taskId: 'task-12',
      llmTurnCount: 7,
      sourceKind: 'specialist',
      payload: {
        headline: 'Verifier is closing the loop.',
      },
    });

    expect(result.record.llm_turn_count).toBe(7);
  });
});
