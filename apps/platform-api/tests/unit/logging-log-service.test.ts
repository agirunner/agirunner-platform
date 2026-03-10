import { describe, expect, it, vi } from 'vitest';

import { LogService, encodeCursor, decodeCursor } from '../../src/logging/log-service.js';

function createMockPool() {
  return { query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };
}

describe('LogService', () => {
  describe('insert', () => {
    it('insertsLogEntryWithAllFields', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        parentSpanId: 'parent-1',
        source: 'platform',
        category: 'api',
        level: 'info',
        operation: 'api.get.projects',
        status: 'completed',
        durationMs: 45,
        payload: { method: 'GET', path: '/api/v1/projects' },
        projectId: 'proj-1',
        workflowId: null,
        taskId: null,
        actorType: 'user',
        actorId: 'user-1',
        actorName: 'Mark',
        resourceType: 'project',
        resourceId: 'proj-1',
        resourceName: 'My Project',
      });

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO execution_logs');
      expect(params[0]).toBe('tenant-1');
      expect(params[1]).toBe('trace-1');
      expect(params[4]).toBe('platform');
      expect(params[5]).toBe('api');
      expect(params[7]).toBe('api.get.projects');
      expect(params[8]).toBe('completed');
      expect(params[9]).toBe(45);
    });

    it('insertsLogEntryWithMinimalFields', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'runtime',
        category: 'llm',
        level: 'info',
        operation: 'llm.chat_stream',
        status: 'completed',
      });

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [, params] = pool.query.mock.calls[0];
      expect(params[3]).toBeNull();
      expect(params[12]).toBeNull();
      expect(params[13]).toBeNull();
      expect(params[14]).toBeNull();
    });

    it('serializesMetadataAsJson', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform',
        category: 'config',
        level: 'info',
        operation: 'config.llm_config.created',
        status: 'completed',
        payload: { provider: 'openai', model: 'gpt-4.1-mini' },
      });

      const [, params] = pool.query.mock.calls[0];
      expect(params[10]).toBe('{"provider":"openai","model":"gpt-4.1-mini"}');
    });

    it('serializesErrorAsJson', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform',
        category: 'api',
        level: 'error',
        operation: 'api.post.workflows',
        status: 'failed',
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input' },
      });

      const [, params] = pool.query.mock.calls[0];
      const errorJson = JSON.parse(params[11] as string);
      expect(errorJson.code).toBe('VALIDATION_ERROR');
      expect(errorJson.message).toBe('Invalid input');
    });
  });

  describe('insertBatch', () => {
    it('insertsMultipleEntriesAndReturnsAcceptedCount', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      const entries = Array.from({ length: 3 }, (_, i) => ({
        tenantId: 'tenant-1',
        traceId: `trace-${i}`,
        spanId: `span-${i}`,
        source: 'runtime' as const,
        category: 'llm' as const,
        level: 'info' as const,
        operation: 'llm.chat_stream',
        status: 'completed' as const,
      }));

      const result = await service.insertBatch(entries);
      expect(result).toEqual({ accepted: 3, rejected: 0 });
      expect(pool.query).toHaveBeenCalledTimes(3);
    });

    it('countsRejectedEntriesOnQueryFailure', async () => {
      const pool = createMockPool();
      pool.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockRejectedValueOnce(new Error('constraint violation'))
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });

      const service = new LogService(pool as never);
      const entries = Array.from({ length: 3 }, (_, i) => ({
        tenantId: 'tenant-1',
        traceId: `trace-${i}`,
        spanId: `span-${i}`,
        source: 'runtime' as const,
        category: 'llm' as const,
        level: 'info' as const,
        operation: 'llm.chat_stream',
        status: 'completed' as const,
      }));

      const result = await service.insertBatch(entries);
      expect(result).toEqual({ accepted: 2, rejected: 1 });
    });

    it('returnsZerosForEmptyBatch', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);
      const result = await service.insertBatch([]);
      expect(result).toEqual({ accepted: 0, rejected: 0 });
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('capsAtMaxBatchSize', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      const entries = Array.from({ length: 120 }, (_, i) => ({
        tenantId: 'tenant-1',
        traceId: `trace-${i}`,
        spanId: `span-${i}`,
        source: 'runtime' as const,
        category: 'llm' as const,
        level: 'info' as const,
        operation: 'llm.chat_stream',
        status: 'completed' as const,
      }));

      const result = await service.insertBatch(entries);
      expect(result.accepted).toBe(100);
      expect(pool.query).toHaveBeenCalledTimes(100);
    });

    it('redactsSecretKeysInMetadata', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insertBatch([{
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'runtime' as const,
        category: 'tool' as const,
        level: 'info' as const,
        operation: 'tool.shell_exec',
        status: 'completed' as const,
        payload: {
          api_key: 'sk-secret-value',
          password: 'my-password',
          safe_field: 'visible',
          tokens_in: 200,
          tokens_out: 150,
          total_tokens: 350,
          nested: { secret_token: 'tok-123', name: 'safe' },
        },
      }]);

      const [, params] = pool.query.mock.calls[0];
      const payload = JSON.parse(params[10] as string);
      expect(payload.api_key).toBe('[REDACTED]');
      expect(payload.password).toBe('[REDACTED]');
      expect(payload.safe_field).toBe('visible');
      expect(payload.tokens_in).toBe(200);
      expect(payload.tokens_out).toBe(150);
      expect(payload.total_tokens).toBe(350);
      expect(payload.nested.secret_token).toBe('[REDACTED]');
      expect(payload.nested.name).toBe('safe');
    });

    it('redactsSecretValuesInMetadata', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insertBatch([{
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'runtime' as const,
        category: 'tool' as const,
        level: 'info' as const,
        operation: 'tool.shell_exec',
        status: 'completed' as const,
        payload: {
          input: 'export API_KEY=sk-abc123',
          output: 'success',
        },
      }]);

      const [, params] = pool.query.mock.calls[0];
      const payload = JSON.parse(params[10] as string);
      expect(payload.input).toBe('[REDACTED]');
      expect(payload.output).toBe('success');
    });
  });

  describe('query', () => {
    it('appliesDefaultTimeBoundsWhenNoTimeFilter', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      await service.query('tenant-1', {});
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('created_at >= $');
      const sinceParam = params.find((p: unknown) => typeof p === 'string' && (p as string).includes('T'));
      expect(sinceParam).toBeTruthy();
    });

    it('doesNotOverrideExplicitTimeBounds', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      await service.query('tenant-1', { since: '2026-01-01T00:00:00Z' });
      const [, params] = pool.query.mock.calls[0];
      expect(params).toContain('2026-01-01T00:00:00Z');
    });

    it('queriesWithDefaultParameters', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      const result = await service.query('tenant-1', {});
      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('FROM execution_logs');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(params[0]).toBe('tenant-1');
      expect(result.pagination.per_page).toBe(100);
      expect(result.pagination.has_more).toBe(false);
      expect(result.pagination.next_cursor).toBeNull();
    });

    it('appliesEntityFilters', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      await service.query('tenant-1', {
        projectId: 'proj-1',
        workflowId: 'wf-1',
        taskId: 'task-1',
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('project_id = $');
      expect(sql).toContain('workflow_id = $');
      expect(sql).toContain('task_id = $');
      expect(params).toContain('proj-1');
      expect(params).toContain('wf-1');
      expect(params).toContain('task-1');
    });

    it('appliesCategoryAndSourceArrayFilters', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

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
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      await service.query('tenant-1', { level: 'warn' });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('level = ANY($');
      expect(params).toContainEqual(['warn', 'error']);
    });

    it('appliesOperationWildcardFilter', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      await service.query('tenant-1', { operation: 'llm.*' });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('operation LIKE $');
      expect(params).toContain('llm.%');
    });

    it('appliesExactOperationFilter', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      await service.query('tenant-1', { operation: 'llm.chat_stream' });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('operation = $');
      expect(params).toContain('llm.chat_stream');
    });

    it('appliesFullTextSearch', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      await service.query('tenant-1', { search: 'shell_exec error' });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('to_tsvector');
      expect(sql).toContain('plainto_tsquery');
      expect(params).toContain('shell_exec error');
    });

    it('appliesTimeRangeFilters', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

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

    it('handlesKeysetPaginationWithCursor', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      const cursor = encodeCursor('500', '2026-03-09T12:00:00.000Z');
      await service.query('tenant-1', { cursor });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('(created_at, id) <');
      expect(params).toContain('2026-03-09T12:00:00.000Z');
      expect(params).toContain('500');
    });

    it('setsHasMoreWhenMoreRowsExist', async () => {
      const pool = createMockPool();
      const fakeRows = Array.from({ length: 11 }, (_, i) => ({
        id: String(i),
        created_at: `2026-03-09T12:00:0${i}.000Z`,
      }));
      pool.query.mockResolvedValue({ rows: fakeRows, rowCount: 11 });
      const service = new LogService(pool as never);

      const result = await service.query('tenant-1', { perPage: 10 });
      expect(result.pagination.has_more).toBe(true);
      expect(result.data).toHaveLength(10);
      expect(result.pagination.next_cursor).toBeTruthy();
    });

    it('setsHasMoreFalseWhenExactPageSize', async () => {
      const pool = createMockPool();
      const fakeRows = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        created_at: `2026-03-09T12:00:0${i}.000Z`,
      }));
      pool.query.mockResolvedValue({ rows: fakeRows, rowCount: 10 });
      const service = new LogService(pool as never);

      const result = await service.query('tenant-1', { perPage: 10 });
      expect(result.pagination.has_more).toBe(false);
      expect(result.data).toHaveLength(10);
      expect(result.pagination.next_cursor).toBeNull();
    });

    it('usesAscOrderWhenRequested', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      await service.query('tenant-1', { order: 'asc' });

      const [sql] = pool.query.mock.calls[0];
      expect(sql).toContain('ORDER BY created_at ASC');
    });

    it('clampsPerPageToMaximum', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      const result = await service.query('tenant-1', { perPage: 9999 });
      expect(result.pagination.per_page).toBe(500);
    });
  });

  describe('stats', () => {
    it('queriesStatsGroupedByCategory', async () => {
      const pool = createMockPool();
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
      const service = new LogService(pool as never);

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
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      await service.stats('tenant-1', {
        traceId: 'trace-1',
        taskId: 'task-1',
        groupBy: 'operation',
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('trace_id = $');
      expect(sql).toContain('task_id = $');
      expect(sql).toContain('GROUP BY operation');
      expect(params).toContain('trace-1');
      expect(params).toContain('task-1');
    });

    it('rejectsInvalidGroupByColumn', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await expect(
        service.stats('tenant-1', {
          groupBy: 'DROP TABLE execution_logs; --' as never,
        }),
      ).rejects.toThrow('Invalid group_by column');
    });
  });

  describe('operations', () => {
    it('queriesDistinctOperationsWithinTimeRange', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({
        rows: [
          { operation: 'llm.chat_stream', count: '1240' },
          { operation: 'tool.shell_exec', count: '890' },
        ],
        rowCount: 2,
      });
      const service = new LogService(pool as never);

      const since = new Date('2026-03-08T00:00:00Z');
      const result = await service.operations('tenant-1', since);

      expect(result).toEqual([
        { operation: 'llm.chat_stream', count: 1240 },
        { operation: 'tool.shell_exec', count: 890 },
      ]);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('GROUP BY operation');
      expect(sql).toContain('LIMIT 100');
      expect(params[0]).toBe('tenant-1');
    });

    it('filtersByCategoryWhenProvided', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      await service.operations('tenant-1', new Date(), 'llm');

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('category = $');
      expect(params).toContain('llm');
    });
  });

  describe('actors', () => {
    it('queriesDistinctActorsWithinTimeRange', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({
        rows: [
          { actor_type: 'user', actor_id: 'u-1', actor_name: 'Mark', count: '45' },
          { actor_type: 'worker', actor_id: 'w-1', actor_name: 'worker-01', count: '3400' },
        ],
        rowCount: 2,
      });
      const service = new LogService(pool as never);

      const result = await service.actors('tenant-1', new Date('2026-03-08T00:00:00Z'));

      expect(result).toEqual([
        { actor_type: 'user', actor_id: 'u-1', actor_name: 'Mark', count: 45 },
        { actor_type: 'worker', actor_id: 'w-1', actor_name: 'worker-01', count: 3400 },
      ]);
      const [sql] = pool.query.mock.calls[0];
      expect(sql).toContain('GROUP BY actor_type, actor_id, actor_name');
      expect(sql).toContain('actor_id IS NOT NULL');
    });
  });

  describe('export', () => {
    it('yieldsAllRowsAcrossMultiplePages', async () => {
      const pool = createMockPool();
      const page1 = Array.from({ length: 3 }, (_, i) => ({
        id: String(i),
        created_at: `2026-03-09T12:00:0${i}.000Z`,
      }));
      const page2 = [{ id: '3', created_at: '2026-03-09T12:00:03.000Z' }];
      pool.query
        .mockResolvedValueOnce({ rows: [...page1, { id: '99', created_at: '2026-03-09T12:00:04.000Z' }], rowCount: 4 })
        .mockResolvedValueOnce({ rows: page2, rowCount: 1 });
      const service = new LogService(pool as never);

      const rows: unknown[] = [];
      for await (const row of service.export('tenant-1', { perPage: 3 })) {
        rows.push(row);
      }
      expect(rows).toHaveLength(4);
    });
  });

  describe('cursor encoding', () => {
    it('roundTripsEncodeDecode', () => {
      const cursor = encodeCursor('12345', '2026-03-09T15:30:00.123Z');
      const decoded = decodeCursor(cursor);
      expect(decoded.id).toBe('12345');
      expect(decoded.createdAt).toBe('2026-03-09T15:30:00.123Z');
    });

    it('producesBase64UrlSafeCursor', () => {
      const cursor = encodeCursor('99999', '2026-03-09T15:30:00.123Z');
      expect(cursor).not.toMatch(/[+/=]/);
    });
  });
});
