import { describe, expect, it } from 'vitest';

import { createLogServiceHarness } from './support.js';

describe('LogService', () => {
  describe('stats', () => {
    it('queriesStatsGroupedByCategory', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({
        rows: [
          {
            group_key: 'llm',
            count: '48',
            error_count: '2',
            total_duration_ms: '94200',
            avg_duration_ms: '1963',
            total_input_tokens: '125000',
            total_output_tokens: '34000',
            total_cost_usd: '1.24',
          },
          {
            group_key: 'tool',
            count: '36',
            error_count: '1',
            total_duration_ms: '48000',
            avg_duration_ms: '1333',
            total_input_tokens: null,
            total_output_tokens: null,
            total_cost_usd: null,
          },
        ],
        rowCount: 2,
      });

      const result = await service.stats('tenant-1', {
        workflowId: 'wf-1',
        groupBy: 'category',
      });

      expect(result.groups).toHaveLength(2);
      expect(result.groups[0].group).toBe('llm');
      expect(result.groups[0].count).toBe(48);
      expect(result.groups[0].agg.total_input_tokens).toBe(125000);
      expect(result.groups[0].agg.total_cost_usd).toBe(1.24);
      expect(result.groups[1].agg.total_input_tokens).toBeUndefined();
      expect(result.totals.count).toBe(84);
      expect(result.totals.error_count).toBe(3);
    });

    it('appliesTraceAndTaskFilters', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.stats('tenant-1', {
        traceId: 'trace-1',
        taskId: 'task-1',
        groupBy: 'operation',
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('trace_id = $');
      expect(sql).toContain('task_id = $');
      expect(sql).toContain("GROUP BY COALESCE(l.operation, 'unknown')");
      expect(params).toContain('trace-1');
      expect(params).toContain('task-1');
    });

    it('supportsWorkItemStageAndActivationGrouping', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({
        rows: [{
          group_key: 'implementation',
          count: '2',
          error_count: '0',
          total_duration_ms: '20',
          avg_duration_ms: '10',
          total_input_tokens: null,
          total_output_tokens: null,
          total_cost_usd: null,
        }],
        rowCount: 1,
      });

      const result = await service.stats('tenant-1', {
        workItemId: 'work-item-1',
        activationId: 'activation-1',
        isOrchestratorTask: true,
        groupBy: 'stage_name',
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("COALESCE(l.stage_name, 'unassigned')");
      expect(sql).toContain('COALESCE(l.work_item_id, task_ctx.work_item_id) = $');
      expect(sql).toContain('activation_id = $');
      expect(sql).toContain('is_orchestrator_task = $');
      expect(params).toContain('work-item-1');
      expect(params).toContain('activation-1');
      expect(params).toContain(true);
      expect(result.groups[0].group).toBe('implementation');
    });

    it('rejectsInvalidGroupByColumn', async () => {
      const { service } = createLogServiceHarness();
      await expect(service.stats('tenant-1', {
        groupBy: 'DROP TABLE execution_logs; --' as never,
      })).rejects.toThrow('Invalid group_by column');
    });
  });

  describe('operations', () => {
    it('queriesDistinctOperationsWithinTimeRange', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({
        rows: [
          { operation: 'llm.chat_stream', count: '1240' },
          { operation: 'tool.shell_exec', count: '890' },
        ],
        rowCount: 2,
      });

      const result = await service.operations('tenant-1', {
        since: new Date('2026-03-08T00:00:00Z').toISOString(),
      });

      expect(result).toEqual([
        { operation: 'llm.chat_stream', count: 1240 },
        { operation: 'tool.shell_exec', count: 890 },
      ]);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('GROUP BY l.operation');
      expect(sql).toContain('LIMIT 100');
      expect(params[0]).toBe('tenant-1');
    });

    it('appliesStructuredFiltersWhenProvided', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.operations('tenant-1', {
        since: new Date('2026-03-08T00:00:00Z').toISOString(),
        workflowId: 'wf-1',
        category: ['llm'],
        level: 'warn',
        role: ['developer'],
        actorKind: ['specialist_task_execution'],
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('category = ANY(');
      expect(sql).toContain('workflow_id = $');
      expect(sql).toContain('level = ANY(');
      expect(sql).toContain('role = ANY(');
      expect(sql).toContain('CASE');
      expect(params).toContain('wf-1');
      expect(params).toContainEqual(['specialist_task_execution']);
    });
  });
});
