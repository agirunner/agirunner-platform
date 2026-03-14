import { describe, expect, it, vi, beforeEach } from 'vitest';

import { MeteringService } from '../../src/services/metering-service.js';

function createMockPool() {
  return {
    query: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
  };
}

describe('MeteringService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: MeteringService;
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const taskId = '00000000-0000-0000-0000-000000000010';

  beforeEach(() => {
    pool = createMockPool();
    service = new MeteringService(pool as never);
  });

  describe('record', () => {
    it('insertsValidMeteringEvent', async () => {
      const row = {
        id: 'abc',
        tenant_id: tenantId,
        task_id: taskId,
        tokens_input: 100,
        tokens_output: 50,
        cost_usd: 0.001,
        wall_time_ms: 500,
      };
      pool.query.mockResolvedValue({ rows: [row] });

      const result = await service.record(tenantId, {
        taskId,
        tokensInput: 100,
        tokensOutput: 50,
        costUsd: 0.001,
        wallTimeMs: 500,
      });

      expect(result).toEqual(row);
      expect(pool.query).toHaveBeenCalledOnce();
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO metering_events');
    });

    it('rejectsNegativeTokens', async () => {
      await expect(
        service.record(tenantId, {
          taskId,
          tokensInput: -1,
          tokensOutput: 0,
          costUsd: 0,
          wallTimeMs: 0,
        }),
      ).rejects.toThrow();
    });

    it('rejectsInvalidTaskId', async () => {
      await expect(
        service.record(tenantId, {
          taskId: 'not-a-uuid',
          tokensInput: 0,
          tokensOutput: 0,
          costUsd: 0,
          wallTimeMs: 0,
        }),
      ).rejects.toThrow();
    });

    it('passesOptionalFieldsAsNull', async () => {
      pool.query.mockResolvedValue({ rows: [{ id: 'x' }] });

      await service.record(tenantId, {
        taskId,
        tokensInput: 0,
        tokensOutput: 0,
        costUsd: 0,
        wallTimeMs: 0,
      });

      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params[2]).toBeNull(); // workflowId
      expect(params[3]).toBeNull(); // workerId
      expect(params[4]).toBeNull(); // agentId
      expect(params[9]).toBeNull(); // cpuMs
      expect(params[10]).toBeNull(); // memoryPeakBytes
      expect(params[11]).toBeNull(); // networkBytes
    });
  });

  describe('query', () => {
    it('queriesWithNoFilters', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await service.query(tenantId, {});

      expect(result).toEqual([]);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('tenant_id = $1');
      expect(sql).not.toContain('created_at >=');
    });

    it('appliesDateRangeFilters', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await service.query(tenantId, { from: '2026-01-01', to: '2026-12-31' });

      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('created_at >= $2');
      expect(sql).toContain('created_at <= $3');
      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params).toEqual([tenantId, '2026-01-01', '2026-12-31']);
    });

    it('appliesWorkflowFilter', async () => {
      const workflowId = '00000000-0000-0000-0000-000000000020';
      pool.query.mockResolvedValue({ rows: [] });

      await service.query(tenantId, { workflowId });

      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('workflow_id = $2');
    });
  });

  describe('summarize', () => {
    it('returnsAggregatedSummary', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            {
              total_tokens_input: '1000',
              total_tokens_output: '500',
              total_cost_usd: '0.05',
              total_wall_time_ms: '10000',
              event_count: '5',
              today_cost: '0.01',
              week_cost: '0.03',
              month_cost: '0.05',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ name: 'Board Alpha', cost: '0.04' }],
        })
        .mockResolvedValueOnce({
          rows: [{ day: '2026-03-13', cost: '0.05' }],
        })
        .mockResolvedValueOnce({
          rows: [{ budget_total: '10.00' }],
        });

      const summary = await service.summarize(tenantId, {});

      expect(summary).toEqual({
        today: 0.01,
        this_week: 0.03,
        this_month: 0.05,
        budget_total: 10,
        budget_remaining: 9.95,
        by_workflow: [{ name: 'Board Alpha', cost: 0.04 }],
        by_model: [],
        daily_trend: [{ date: '2026-03-13', cost: 0.05 }],
        totalTokensInput: 1000,
        totalTokensOutput: 500,
        totalCostUsd: 0.05,
        totalWallTimeMs: 10000,
        eventCount: 5,
      });
    });

    it('returnsZerosWhenNoEvents', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            {
              total_tokens_input: '0',
              total_tokens_output: '0',
              total_cost_usd: '0',
              total_wall_time_ms: '0',
              event_count: '0',
              today_cost: '0',
              week_cost: '0',
              month_cost: '0',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ budget_total: '0' }] });

      const summary = await service.summarize(tenantId, {});

      expect(summary.eventCount).toBe(0);
      expect(summary.totalCostUsd).toBe(0);
      expect(summary.by_workflow).toEqual([]);
      expect(summary.daily_trend).toEqual([]);
      expect(summary.budget_total).toBe(0);
    });
  });
});
