import { describe, expect, it } from 'vitest';

import { createLogServiceHarness } from './logging-log-service-support.js';

describe('LogService', () => {
  describe('distinct value endpoints', () => {
    it('queriesDistinctOperationValuesWithoutCounts', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({
        rows: [{ operation: 'llm.chat_stream' }, { operation: 'tool.shell_exec' }],
        rowCount: 2,
      });

      const result = await service.operationValues('tenant-1', {
        since: new Date('2026-03-08T00:00:00Z').toISOString(),
        workflowId: 'wf-1',
      });

      expect(result).toEqual([
        { operation: 'llm.chat_stream' },
        { operation: 'tool.shell_exec' },
      ]);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('SELECT DISTINCT l.operation');
      expect(sql).not.toContain('COUNT(*)');
      expect(sql).not.toContain('GROUP BY');
      expect(params).toContain('wf-1');
    });

    it('queriesScopedRolesFromExecutionLogsOnly', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({
        rows: [{ role: 'developer', count: '12' }],
        rowCount: 1,
      });

      const result = await service.roles('tenant-1', {
        since: new Date('2026-03-08T00:00:00Z').toISOString(),
        workflowId: 'wf-1',
        operation: ['tool.exec'],
        actorKind: ['specialist_task_execution'],
      });

      expect(result).toEqual([{ role: 'developer', count: 12 }]);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('FROM execution_logs');
      expect(sql).not.toContain('UNION ALL');
      expect(sql).toContain('workflow_id = $');
      expect(sql).toContain('operation = ANY(');
      expect(sql).toContain('CASE');
      expect(params).toContain('wf-1');
      expect(params).toContainEqual(['specialist_task_execution']);
    });

    it('queriesDistinctRoleValuesWithoutCounts', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({
        rows: [{ role: 'developer' }, { role: 'reviewer' }],
        rowCount: 2,
      });

      const result = await service.roleValues('tenant-1', {
        since: new Date('2026-03-08T00:00:00Z').toISOString(),
        workflowId: 'wf-1',
      });

      expect(result).toEqual([{ role: 'developer' }, { role: 'reviewer' }]);
      const [sql] = pool.query.mock.calls[0];
      expect(sql).toContain('SELECT DISTINCT l.role');
      expect(sql).not.toContain('COUNT(*)');
      expect(sql).not.toContain('GROUP BY');
    });
  });
});
