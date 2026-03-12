import { describe, expect, it, vi } from 'vitest';

import { ConflictError } from '../../src/errors/domain-errors.js';
import { WorkflowToolResultService } from '../../src/services/workflow-tool-result-service.js';

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

  it('returns the previously stored response on duplicate request ids', async () => {
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
});
