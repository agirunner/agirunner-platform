import { describe, expect, it } from 'vitest';

import { LogService } from '../../../../src/logging/execution/log-service.js';
import {
  createLogServiceHarness,
  createMockPool,
} from './support.js';

describe('LogService', () => {
  describe('query', () => {
    it('loadsSingleLogRowsByTenantAndId', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({
        rowCount: 1,
        rows: [{
          id: 'log-1',
          tenant_id: 'tenant-1',
          created_at: '2026-03-12T00:00:00.000Z',
          execution_environment_id: 'env-default',
          execution_environment_name: 'Debian Base',
          execution_environment_image: 'debian:trixie-slim',
        }],
      });
      const service = new LogService(pool as never);

      const result = await service.getById('tenant-1', 'log-1');

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('FROM execution_logs');
      expect(sql).toContain('LEFT JOIN tasks task_ctx');
      expect(sql).toContain('execution_environment_snapshot');
      expect(sql).toContain('id = $2');
      expect(params).toEqual(['tenant-1', 'log-1']);
      expect(result).toEqual(expect.objectContaining({
        id: 'log-1',
        execution_environment_name: 'Debian Base',
      }));
    });

    it('appliesDefaultTimeBoundsWhenNoTimeFilter', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', {});

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('created_at >= $');
      expect(params.find((value: unknown) => typeof value === 'string' && value.includes('T'))).toBeTruthy();
    });

    it('doesNotOverrideExplicitTimeBounds', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', { since: '2026-01-01T00:00:00Z' });

      expect(pool.query.mock.calls[0][1]).toContain('2026-01-01T00:00:00Z');
    });

    it('queriesWithDefaultParameters', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await service.query('tenant-1', {});

      const [sql, params] = pool.query.mock.calls[0];
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(sql).toContain('FROM execution_logs');
      expect(sql).toContain('LEFT JOIN tasks task_ctx');
      expect(sql).toContain('ORDER BY l.created_at DESC');
      expect(params[0]).toBe('tenant-1');
      expect(result.pagination.per_page).toBe(100);
      expect(result.pagination.has_more).toBe(false);
      expect(result.pagination.next_cursor).toBeNull();
    });

    it('appliesEntityFilters', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', {
        workspaceId: 'proj-1',
        workflowId: 'wf-1',
        taskId: 'task-1',
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('workspace_id = $');
      expect(sql).toContain('workflow_id = $');
      expect(sql).toContain('task_id = $');
      expect(params).toContain('proj-1');
      expect(params).toContain('wf-1');
      expect(params).toContain('task-1');
    });

    it('filters work-item queries against the effective task-linked work item id', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', {
        workflowId: 'wf-1',
        workItemId: 'work-item-1',
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('COALESCE(l.work_item_id, task_ctx.work_item_id) AS work_item_id');
      expect(sql).toContain('COALESCE(l.work_item_id, task_ctx.work_item_id) = $');
      expect(params).toContain('work-item-1');
    });

    it('appliesCategoryAndSourceArrayFilters', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', {
        source: ['runtime', 'platform'],
        category: ['llm', 'tool'],
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('source = ANY($');
      expect(sql).toContain('category = ANY($');
      expect(params).toContainEqual(['runtime', 'platform']);
      expect(params).toContainEqual(['llm', 'tool']);
    });

    it('appliesMinimumLevelFilter', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', { level: 'warn' });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('level = ANY($');
      expect(params).toContainEqual(['warn', 'error']);
    });

    it('appliesOperationWildcardFilter', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', { operation: ['llm.*'] });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('operation LIKE $');
      expect(params).toContain('llm.%');
    });

    it('appliesExactOperationFilter', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', { operation: ['llm.chat_stream'] });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('operation = ANY($');
      expect(params).toContainEqual(['llm.chat_stream']);
    });

    it('appliesFullTextSearch', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', { search: 'shell_exec error' });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("to_tsvector('simple'");
      expect(sql).toContain("websearch_to_tsquery('simple'");
      expect(sql).not.toContain('CONCAT_WS(');
      expect(sql).toContain("COALESCE(l.operation, '')");
      expect(sql).toContain("COALESCE(l.trace_id::text, '')");
      expect(sql).not.toContain('ILIKE');
      expect(params).toContain('shell_exec error');
    });

    it('filters logs by task execution environment name, image, or id', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', { executionEnvironment: 'debian' });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('execution_environment_snapshot');
      expect(sql).toContain('LOWER(');
      expect(sql).toContain('LIKE $');
      expect(sql).not.toContain('ILIKE');
      expect(sql).toContain("task_ctx.execution_environment_snapshot->>'name'");
      expect(sql).toContain("task_ctx.execution_environment_snapshot->>'image'");
      expect(sql).toContain("task_ctx.execution_environment_snapshot->>'resolved_image'");
      expect(params).toContain('%debian%');
    });

    it('indexes prompt-related payload fields in the search document', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', { search: 'prompt' });

      const [sql] = pool.query.mock.calls[0];
      expect(sql).toContain('system_prompt');
      expect(sql).toContain('prompt_summary');
      expect(sql).toContain('response_summary');
      expect(sql).toContain('response_text');
    });

    it('appliesTimeRangeFilters', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await service.query('tenant-1', {
        since: '2026-03-01T00:00:00Z',
        until: '2026-03-09T23:59:59Z',
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('created_at >= $');
      expect(sql).toContain('created_at <= $');
      expect(params).toContain('2026-03-01T00:00:00Z');
      expect(params).toContain('2026-03-09T23:59:59Z');
    });

  });
});
