import { describe, expect, it, vi } from 'vitest';

const { logSafetynetTriggeredMock } = vi.hoisted(() => ({
  logSafetynetTriggeredMock: vi.fn(),
}));

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: logSafetynetTriggeredMock,
}));

import { ConflictError } from '../../../src/errors/domain-errors.js';
import { WorkflowToolResultService } from '../../../src/services/workflow-tool-result-service.js';
import { buildRecoverableMutationResult } from '../../../src/services/guided-closure/types.js';

describe('WorkflowToolResultService', () => {
  it('takes a transaction-scoped advisory lock before running a request-idempotent mutation', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        expect(sql).toContain('pg_advisory_xact_lock');
        expect(params).toEqual(['tenant-1:workflow-1', 'create_work_item:req-1']);
        return { rowCount: 1, rows: [] };
      }),
    };

    const service = new WorkflowToolResultService(pool as never);

    await service.lockRequest('tenant-1', 'workflow-1', 'create_work_item', 'req-1');

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('stores and returns the inserted tool response on first write', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'create_work_item',
            'req-1',
            { work_item_id: 'wi-1' },
            null,
            null,
          ]);
          return {
            rowCount: 1,
            rows: [{ response: { work_item_id: 'wi-1' } }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkflowToolResultService(pool as never);

    const response = await service.storeResult(
      'tenant-1',
      'workflow-1',
      'create_work_item',
      'req-1',
      { work_item_id: 'wi-1' },
    );

    expect(response).toEqual({ work_item_id: 'wi-1' });
  });

  it('stores guided closure outcome metadata next to the response envelope', async () => {
    const response = buildRecoverableMutationResult({
      recovery_class: 'approval_not_configured',
      reason_code: 'approval_not_configured',
      blocking: false,
      closure_still_possible: true,
      state_snapshot: {
        workflow_id: 'workflow-1',
        work_item_id: 'wi-1',
        task_id: 'task-1',
        current_stage: 'review',
        active_blocking_controls: [],
        active_advisory_controls: [],
      },
      suggested_next_actions: [
        {
          action_code: 'continue_work',
          target_type: 'work_item',
          target_id: 'wi-1',
          why: 'No blocking approval gate is configured.',
          requires_orchestrator_judgment: false,
        },
      ],
      suggested_target_ids: {
        workflow_id: 'workflow-1',
        work_item_id: 'wi-1',
        task_id: 'task-1',
      },
      callout_recommendations: [],
    });

    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'request_gate_approval',
            'req-guided-1',
            response,
            'recoverable_not_applied',
            'approval_not_configured',
          ]);
          return {
            rowCount: 1,
            rows: [{ response }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkflowToolResultService(pool as never);

    const stored = await service.storeResult(
      'tenant-1',
      'workflow-1',
      'request_gate_approval',
      'req-guided-1',
      response,
    );

    expect(stored).toEqual(response);
  });

  it('returns the previously stored response on duplicate request ids', async () => {
    logSafetynetTriggeredMock.mockReset();
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT response')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'create_work_item',
            'req-1',
          ]);
          return {
            rowCount: 1,
            rows: [{ response: { work_item_id: 'wi-existing', status: 'deduped' } }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkflowToolResultService(pool as never);

    const response = await service.storeResult(
      'tenant-1',
      'workflow-1',
      'create_work_item',
      'req-1',
      { work_item_id: 'wi-existing', status: 'deduped' },
    );

    expect(response).toEqual({ work_item_id: 'wi-existing', status: 'deduped' });
    expect(logSafetynetTriggeredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'platform.control_plane.idempotent_mutation_replay',
      }),
      'idempotent workflow tool mutation replay returned stored result',
      expect.objectContaining({
        workflow_id: 'workflow-1',
        tool_name: 'create_work_item',
        request_id: 'req-1',
      }),
    );
  });

  it('treats reordered JSON object keys as the same stored tool result', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT response')) {
          return {
            rowCount: 1,
            rows: [{ response: { status: 'deduped', work_item_id: 'wi-existing' } }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkflowToolResultService(pool as never);

    const response = await service.storeResult(
      'tenant-1',
      'workflow-1',
      'create_work_item',
      'req-1',
      { work_item_id: 'wi-existing', status: 'deduped' },
    );

    expect(response).toEqual({ status: 'deduped', work_item_id: 'wi-existing' });
  });

  it('rejects a duplicate request id when the stored tool result does not match', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT response')) {
          return {
            rowCount: 1,
            rows: [{ response: { work_item_id: 'wi-existing', status: 'deduped' } }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkflowToolResultService(pool as never);

    await expect(
      service.storeResult(
        'tenant-1',
        'workflow-1',
        'create_work_item',
        'req-1',
        { work_item_id: 'wi-new' },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('fails closed when a duplicate tool-result conflict cannot be reloaded', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO workflow_tool_results')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT response')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkflowToolResultService(pool as never);

    await expect(
      service.storeResult(
        'tenant-1',
        'workflow-1',
        'create_work_item',
        'req-1',
        { work_item_id: 'wi-new' },
      ),
    ).rejects.toThrow('Failed to load existing workflow tool result after conflict');
  });

  it('looks up existing results by tenant, workflow, tool, and request id', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT response')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'advance_stage',
            'req-7',
          ]);
          return {
            rowCount: 1,
            rows: [{ response: { next_stage: 'implementation' } }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkflowToolResultService(pool as never);

    const response = await service.getResult(
      'tenant-1',
      'workflow-1',
      'advance_stage',
      'req-7',
    );

    expect(response).toEqual({ next_stage: 'implementation' });
  });

  it('replaces an existing stored tool result after post-commit side-effect delivery completes', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('UPDATE workflow_tool_results')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'send_task_message',
            'msg-1',
            { success: true, delivery_state: 'delivered' },
            null,
            null,
          ]);
          return {
            rowCount: 1,
            rows: [{ response: { success: true, delivery_state: 'delivered' } }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkflowToolResultService(pool as never);

    const response = await service.replaceResult(
      'tenant-1',
      'workflow-1',
      'send_task_message',
      'msg-1',
      { success: true, delivery_state: 'delivered' },
    );

    expect(response).toEqual({ success: true, delivery_state: 'delivered' });
  });
});
