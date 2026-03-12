import { describe, expect, it, vi } from 'vitest';

import { WorkflowToolResultService } from '../../src/services/workflow-tool-result-service.js';

describe('WorkflowToolResultService', () => {
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
      { work_item_id: 'wi-new' },
    );

    expect(response).toEqual({ work_item_id: 'wi-existing', status: 'deduped' });
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
