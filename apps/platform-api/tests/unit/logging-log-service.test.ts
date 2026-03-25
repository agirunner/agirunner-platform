import { describe, expect, it, vi } from 'vitest';

import { LogService, encodeCursor, decodeCursor } from '../../src/logging/log-service.js';

function createMockPool() {
  return { query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };
}

function getInsertCall(pool: ReturnType<typeof createMockPool>) {
  return pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO execution_logs'));
}

function getPartitionCalls(pool: ReturnType<typeof createMockPool>) {
  return pool.query.mock.calls.filter(([sql]) =>
    String(sql).includes('create_execution_logs_partition'),
  );
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
        operation: 'api.get.workspaces',
        status: 'completed',
        durationMs: 45,
        payload: { method: 'GET', path: '/api/v1/workspaces' },
        workspaceId: 'proj-1',
        workflowId: null,
        taskId: null,
        executionBackend: 'runtime_only',
        toolOwner: 'runtime',
        actorType: 'user',
        actorId: 'user-1',
        actorName: 'Mark',
        resourceType: 'workspace',
        resourceId: '00000000-0000-0000-0000-000000000111',
        resourceName: 'My Workspace',
      });

      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(getPartitionCalls(pool)).toHaveLength(1);
      const [sql, params] = getInsertCall(pool)!;
      expect(sql).toContain('INSERT INTO execution_logs');
      expect(params[0]).toBe('tenant-1');
      expect(params[1]).toBe('trace-1');
      expect(params[4]).toBe('platform');
      expect(params[5]).toBe('api');
      expect(params[7]).toBe('api.get.workspaces');
      expect(params[8]).toBe('completed');
      expect(params[9]).toBe(45);
      expect(sql).toContain('execution_backend');
      expect(sql).toContain('tool_owner');
      expect(params[22]).toBe('runtime_only');
      expect(params[23]).toBe('runtime');
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

      expect(pool.query).toHaveBeenCalledTimes(2);
      const [, params] = getInsertCall(pool)!;
      expect(params[3]).toBeNull();
      expect(params[12]).toBeNull();
      expect(params[13]).toBeNull();
      expect(params[14]).toBeNull();
      expect(params[17]).toBeNull();
      expect(params[18]).toBeNull();
      expect(params[20]).toBeNull();
      expect(params[21]).toBe(false);
      expect(params[22]).toBeNull();
      expect(params[23]).toBeNull();
    });

    it('storesStageContextOnlyInCanonicalStageField', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform',
        category: 'task_lifecycle',
        level: 'info',
        operation: 'task_lifecycle.task.created',
        status: 'completed',
        workflowId: 'wf-1',
        taskId: 'task-1',
        workItemId: 'work-item-1',
        activationId: 'activation-1',
        stageName: 'implementation',
        isOrchestratorTask: true,
      });

      const [, params] = getInsertCall(pool)!;
      expect(params[17]).toBe('work-item-1');
      expect(params[18]).toBe('activation-1');
      expect(params[20]).toBe('implementation');
      expect(params[21]).toBe(true);
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

      const [, params] = getInsertCall(pool)!;
      expect(params[10]).toBe('{"provider":"openai","model":"gpt-4.1-mini"}');
    });

    it('redacts embedded token-like secrets inside longer prose before insert', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform',
        category: 'auth',
        level: 'error',
        operation: 'auth.oauth_connection.failed',
        status: 'failed',
        payload: {
          detail:
            'User pasted eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature into the transcript.',
        },
        error: {
          code: 'AUTH_FAILED',
          message: 'Captured sk-live-abc123xyz987 in the failure summary.',
        },
      });

      const [, params] = getInsertCall(pool)!;
      expect(params[10]).toBe('{"detail":"[REDACTED]"}');
      expect(params[11]).toBe('{"code":"AUTH_FAILED","message":"[REDACTED]"}');
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

      const [, params] = getInsertCall(pool)!;
      const errorJson = JSON.parse(params[11] as string);
      expect(errorJson.code).toBe('VALIDATION_ERROR');
      expect(errorJson.message).toBe('Invalid input');
    });

    it('ensuresPartitionOnlyOncePerDate', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform',
        category: 'api',
        level: 'info',
        operation: 'api.first',
        status: 'completed',
        createdAt: '2026-03-12T11:28:01.888699Z',
      });
      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-2',
        spanId: 'span-2',
        source: 'platform',
        category: 'api',
        level: 'info',
        operation: 'api.second',
        status: 'completed',
        createdAt: '2026-03-12T12:00:00.000Z',
      });

      expect(getPartitionCalls(pool)).toHaveLength(1);
      expect(pool.query).toHaveBeenCalledTimes(3);
    });

    it('treats duplicate partition creation races as success', async () => {
      const pool = createMockPool();
      pool.query
        .mockRejectedValueOnce(
          Object.assign(new Error('relation "execution_logs_2026_03_13" already exists'), {
            code: '42P07',
          }),
        )
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform',
        category: 'api',
        level: 'info',
        operation: 'api.partition-race',
        status: 'completed',
        createdAt: '2026-03-13T11:28:01.888699Z',
      });

      expect(getPartitionCalls(pool)).toHaveLength(1);
      expect(getInsertCall(pool)).toBeDefined();
    });

    it('treats duplicate_object partition creation races as success', async () => {
      const pool = createMockPool();
      pool.query
        .mockRejectedValueOnce({
          code: '42710',
          message: 'relation "execution_logs_2026_03_13" already exists',
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform',
        category: 'api',
        level: 'info',
        operation: 'api.partition-race-duplicate-object',
        status: 'completed',
        createdAt: '2026-03-13T11:28:01.888699Z',
      });

      expect(getPartitionCalls(pool)).toHaveLength(1);
      expect(getInsertCall(pool)).toBeDefined();
    });

    it('treats plain database error objects for duplicate partition creation as success', async () => {
      const pool = createMockPool();
      pool.query
        .mockRejectedValueOnce({
          message: 'relation "execution_logs_2026_03_13" already exists',
          code: '42P07',
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform',
        category: 'api',
        level: 'info',
        operation: 'api.partition-race-object',
        status: 'completed',
        createdAt: '2026-03-13T11:28:01.888699Z',
      });

      expect(getPartitionCalls(pool)).toHaveLength(1);
      expect(getInsertCall(pool)).toBeDefined();
    });

    it('deduplicates concurrent partition creation for the same date', async () => {
      const deferred = createDeferred<{ rowCount: number; rows: never[] }>();
      const pool = {
        query: vi.fn(async (sql: unknown) => {
          if (String(sql).includes('create_execution_logs_partition')) {
            return deferred.promise;
          }
          return { rowCount: 1, rows: [] };
        }),
      };
      const service = new LogService(pool as never);

      const firstInsert = service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform',
        category: 'api',
        level: 'info',
        operation: 'api.concurrent-first',
        status: 'completed',
        createdAt: '2026-03-13T11:28:01.888699Z',
      });
      const secondInsert = service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-2',
        spanId: 'span-2',
        source: 'platform',
        category: 'api',
        level: 'info',
        operation: 'api.concurrent-second',
        status: 'completed',
        createdAt: '2026-03-13T12:28:01.888699Z',
      });

      await Promise.resolve();
      expect(getPartitionCalls(pool as ReturnType<typeof createMockPool>)).toHaveLength(1);

      deferred.resolve({ rowCount: 1, rows: [] });
      await Promise.all([firstInsert, secondInsert]);

      const insertCalls = pool.query.mock.calls.filter(([sql]) =>
        String(sql).includes('INSERT INTO execution_logs'),
      );
      expect(insertCalls).toHaveLength(2);
      expect(getPartitionCalls(pool as ReturnType<typeof createMockPool>)).toHaveLength(1);
    });

    it('retriesInsertAfterCreatingMissingPartition', async () => {
      const pool = createMockPool();
      pool.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockRejectedValueOnce(
          new Error('no partition of relation "execution_logs" found for row'),
        )
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform',
        category: 'api',
        level: 'info',
        operation: 'api.retry',
        status: 'completed',
        createdAt: '2026-03-12T11:28:01.888699Z',
      });

      expect(getPartitionCalls(pool)).toHaveLength(2);
      const insertCalls = pool.query.mock.calls.filter(([sql]) =>
        String(sql).includes('INSERT INTO execution_logs'),
      );
      expect(insertCalls).toHaveLength(2);
    });

    it('retries missing-partition inserts when the driver error is not an Error instance', async () => {
      const pool = createMockPool();
      pool.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockRejectedValueOnce({
          message: 'no partition of relation "execution_logs" found for row',
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform',
        category: 'api',
        level: 'info',
        operation: 'api.retry-plain-object',
        status: 'completed',
        createdAt: '2026-03-12T11:28:01.888699Z',
      });

      expect(getPartitionCalls(pool)).toHaveLength(2);
      const insertCalls = pool.query.mock.calls.filter(([sql]) =>
        String(sql).includes('INSERT INTO execution_logs'),
      );
      expect(insertCalls).toHaveLength(2);
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
      expect(result).toEqual({ accepted: 3, rejected: 0, rejection_details: [] });
      expect(getPartitionCalls(pool)).toHaveLength(1);
      expect(pool.query).toHaveBeenCalledTimes(4);
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
      expect(result).toEqual({
        accepted: 2,
        rejected: 1,
        rejection_details: [
          {
            index: 0,
            trace_id: 'trace-0',
            operation: 'llm.chat_stream',
            reason: 'constraint violation',
          },
        ],
      });
    });

    it('returnsZerosForEmptyBatch', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);
      const result = await service.insertBatch([]);
      expect(result).toEqual({ accepted: 0, rejected: 0, rejection_details: [] });
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
      expect(getPartitionCalls(pool)).toHaveLength(1);
      expect(pool.query).toHaveBeenCalledTimes(101);
    });

    it('redactsSecretKeysOnDirectInsert', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform' as const,
        category: 'config' as const,
        level: 'info' as const,
        operation: 'config.provider.created',
        status: 'completed' as const,
        payload: {
          api_key: 'sk-secret-value',
          safe_field: 'visible',
        },
      });

      const [, params] = getInsertCall(pool)!;
      const payload = JSON.parse(params[10] as string);
      expect(payload.api_key).toBe('[REDACTED]');
      expect(payload.safe_field).toBe('visible');
    });

    it('redactsSecretKeysInBatchInsert', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insertBatch([
        {
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
        },
      ]);

      const [, params] = getInsertCall(pool)!;
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

      await service.insertBatch([
        {
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
        },
      ]);

      const [, params] = getInsertCall(pool)!;
      const payload = JSON.parse(params[10] as string);
      expect(payload.input).toBe('[REDACTED]');
      expect(payload.output).toBe('success');
    });

    it('sanitizes null bytes in payload and error fields before insert', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'runtime' as const,
        category: 'llm' as const,
        level: 'info' as const,
        operation: 'llm.chat_stream',
        status: 'completed' as const,
        payload: {
          prompt_summary: 'hello\u0000world',
          nested: { response_summary: 'good\u0000bye' },
        },
        error: { message: 'bad\u0000news' },
      });

      const [, params] = getInsertCall(pool)!;
      const payload = JSON.parse(params[10] as string);
      const error = JSON.parse(params[11] as string);
      expect(payload.prompt_summary).toBe('helloworld');
      expect(payload.nested.response_summary).toBe('goodbye');
      expect(error.message).toBe('badnews');
    });

    it('redacts secrets inside full buffered llm payload fields', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'runtime' as const,
        category: 'llm' as const,
        level: 'info' as const,
        operation: 'llm.chat_stream',
        status: 'completed' as const,
        payload: {
          messages: [
            { role: 'user', content: 'Use sk-live-secret-value for this call' },
            { role: 'assistant', content: 'Bearer top-secret-token' },
          ],
          response_text: 'The key is sk-live-secret-value',
          response_tool_calls: [
            { id: 'call-1', name: 'web_fetch', input: { authorization: 'Bearer top-secret-token' } },
          ],
        },
      });

      const [, params] = getInsertCall(pool)!;
      const payload = JSON.parse(params[10] as string);
      expect(payload.messages).toEqual([
        { role: 'user', content: '[REDACTED]' },
        { role: 'assistant', content: '[REDACTED]' },
      ]);
      expect(payload.response_text).toBe('[REDACTED]');
      expect(payload.response_tool_calls).toEqual([
        { id: 'call-1', name: 'web_fetch', input: { authorization: '[REDACTED]' } },
      ]);
    });

    it('moves non-uuid resource identifiers into resource_name instead of rejecting the row', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'runtime' as const,
        category: 'container' as const,
        level: 'info' as const,
        operation: 'container.exec',
        status: 'completed' as const,
        resourceType: 'container',
        resourceId: 'runtime-a59dbff2-b12b9434',
      });

      const [, params] = getInsertCall(pool)!;
      expect(params[29]).toBeNull();
      expect(params[30]).toBe('runtime-a59dbff2-b12b9434');
    });

    it('redactsEncryptedAndReferencedSecretsInNestedArraysAndErrors', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform' as const,
        category: 'auth' as const,
        level: 'error' as const,
        operation: 'auth.oauth_connection.failed',
        status: 'failed' as const,
        payload: {
          credentials: [
            { access_token: 'enc:v1:token:payload:tag' },
            { api_key_secret_ref: 'secret:OPENAI_API_KEY' },
          ],
        },
        error: {
          message: 'Bearer sk-secret-value leaked',
          stack: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
        },
      });

      const [, params] = getInsertCall(pool)!;
      const payload = JSON.parse(params[10] as string);
      const error = JSON.parse(params[11] as string);

      expect(payload.credentials).toBe('[REDACTED]');
      expect(error.message).toBe('[REDACTED]');
      expect(error.stack).toBe('[REDACTED]');
    });
  });

  describe('query', () => {
    it('loadsSingleLogRowsByTenantAndId', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({
        rowCount: 1,
        rows: [{ id: 'log-1', tenant_id: 'tenant-1', created_at: '2026-03-12T00:00:00.000Z' }],
      });
      const service = new LogService(pool as never);

      const result = await service.getById('tenant-1', 'log-1');

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('FROM execution_logs');
      expect(sql).toContain('id = $2');
      expect(params).toEqual(['tenant-1', 'log-1']);
      expect(result).toEqual(expect.objectContaining({ id: 'log-1' }));
    });

    it('appliesDefaultTimeBoundsWhenNoTimeFilter', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      await service.query('tenant-1', {});
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('created_at >= $');
      const sinceParam = params.find(
        (p: unknown) => typeof p === 'string' && (p as string).includes('T'),
      );
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

      await service.query('tenant-1', { operation: ['llm.*'] });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('operation LIKE $');
      expect(params).toContain('llm.%');
    });

    it('appliesExactOperationFilter', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      await service.query('tenant-1', { operation: ['llm.chat_stream'] });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('operation = ANY($');
      expect(params).toContainEqual(['llm.chat_stream']);
    });

    it('appliesFullTextSearch', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      await service.query('tenant-1', { search: 'shell_exec error' });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("to_tsvector('simple'");
      expect(sql).toContain("websearch_to_tsquery('simple'");
      expect(sql).not.toContain('CONCAT_WS(');
      expect(sql).toContain("COALESCE(operation, '')");
      expect(sql).toContain("COALESCE(trace_id::text, '')");
      expect(sql).not.toContain('ILIKE');
      expect(params).toContain('shell_exec error');
    });

    it('indexes prompt-related payload fields in the search document', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      await service.query('tenant-1', { search: 'prompt' });

      const [sql] = pool.query.mock.calls[0];
      expect(sql).toContain('system_prompt');
      expect(sql).toContain('prompt_summary');
      expect(sql).toContain('response_summary');
      expect(sql).toContain('response_text');
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

    it('usesAscendingKeysetComparatorWhenCursorAndAscOrderAreRequested', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      const cursor = encodeCursor('500', '2026-03-09T12:00:00.000Z');
      await service.query('tenant-1', { cursor, order: 'asc' });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('(created_at, id) >');
      expect(sql).toContain('ORDER BY created_at ASC');
      expect(params).toContain('2026-03-09T12:00:00.000Z');
      expect(params).toContain('500');
    });

    it('clampsPerPageToMaximum', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

      const result = await service.query('tenant-1', { perPage: 9999 });
      expect(result.pagination.per_page).toBe(500);
    });

    it('exports inspector logs across multiple keyset pages without over-fetching page size', async () => {
      const pool = createMockPool();
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'log-3', created_at: '2026-03-09T12:00:03.000Z' },
            { id: 'log-2', created_at: '2026-03-09T12:00:02.000Z' },
            { id: 'log-1', created_at: '2026-03-09T12:00:01.000Z' },
          ],
          rowCount: 3,
        })
        .mockResolvedValueOnce({
          rows: [
            { id: 'log-0', created_at: '2026-03-09T12:00:00.000Z' },
          ],
          rowCount: 1,
        });
      const service = new LogService(pool as never);

      const exportedIds: string[] = [];
      for await (const row of service.export('tenant-1', { perPage: 2 })) {
        exportedIds.push(String(row.id));
      }

      expect(exportedIds).toEqual(['log-3', 'log-2', 'log-0']);
      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(pool.query.mock.calls[0][1]?.at(-1)).toBe(3);
      expect(pool.query.mock.calls[1][1]).toContain('log-2');
      expect(pool.query.mock.calls[1][1]?.at(-1)).toBe(3);
    });

    it('exports inspector logs deterministically across multiple full pages with stable cursors', async () => {
      const pool = createMockPool();
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 'log-5', created_at: '2026-03-09T12:00:05.000Z' },
            { id: 'log-4', created_at: '2026-03-09T12:00:04.000Z' },
            { id: 'log-3', created_at: '2026-03-09T12:00:03.000Z' },
          ],
          rowCount: 3,
        })
        .mockResolvedValueOnce({
          rows: [
            { id: 'log-3', created_at: '2026-03-09T12:00:03.000Z' },
            { id: 'log-2', created_at: '2026-03-09T12:00:02.000Z' },
            { id: 'log-1', created_at: '2026-03-09T12:00:01.000Z' },
          ],
          rowCount: 3,
        })
        .mockResolvedValueOnce({
          rows: [
            { id: 'log-1', created_at: '2026-03-09T12:00:01.000Z' },
            { id: 'log-0', created_at: '2026-03-09T12:00:00.000Z' },
          ],
          rowCount: 2,
        });
      const service = new LogService(pool as never);

      const exportedIds: string[] = [];
      for await (const row of service.export('tenant-1', { perPage: 2 })) {
        exportedIds.push(String(row.id));
      }

      expect(exportedIds).toEqual(['log-5', 'log-4', 'log-3', 'log-2', 'log-1', 'log-0']);
      expect(pool.query).toHaveBeenCalledTimes(3);
      expect(pool.query.mock.calls[0][1]?.at(-1)).toBe(3);
      expect(pool.query.mock.calls[1][1]).toContain('log-4');
      expect(pool.query.mock.calls[1][1]?.at(-1)).toBe(3);
      expect(pool.query.mock.calls[2][1]).toContain('log-2');
      expect(pool.query.mock.calls[2][1]?.at(-1)).toBe(3);
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
      expect(sql).toContain("GROUP BY COALESCE(operation, 'unknown')");
      expect(params).toContain('trace-1');
      expect(params).toContain('task-1');
    });

    it('supportsWorkItemStageAndActivationGrouping', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({
        rows: [
          {
            group_key: 'implementation',
            count: '2',
            error_count: '0',
            total_duration_ms: '20',
            avg_duration_ms: '10',
            total_input_tokens: null,
            total_output_tokens: null,
            total_cost_usd: null,
          },
        ],
        rowCount: 1,
      });
      const service = new LogService(pool as never);

      const result = await service.stats('tenant-1', {
        workItemId: 'work-item-1',
        activationId: 'activation-1',
        isOrchestratorTask: true,
        groupBy: 'stage_name',
      });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("COALESCE(stage_name, 'unassigned')");
      expect(sql).toContain('work_item_id = $');
      expect(sql).toContain('activation_id = $');
      expect(sql).toContain('is_orchestrator_task = $');
      expect(params).toContain('work-item-1');
      expect(params).toContain('activation-1');
      expect(params).toContain(true);
      expect(result.groups[0].group).toBe('implementation');
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
      const result = await service.operations('tenant-1', { since: since.toISOString() });

      expect(result).toEqual([
        { operation: 'llm.chat_stream', count: 1240 },
        { operation: 'tool.shell_exec', count: 890 },
      ]);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('GROUP BY operation');
      expect(sql).toContain('LIMIT 100');
      expect(params[0]).toBe('tenant-1');
    });

    it('appliesStructuredFiltersWhenProvided', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const service = new LogService(pool as never);

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

  describe('roles', () => {
    it('queriesScopedRolesFromExecutionLogsOnly', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({
        rows: [{ role: 'developer', count: '12' }],
        rowCount: 1,
      });
      const service = new LogService(pool as never);

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
  });

  describe('actors', () => {
    it('queriesDistinctActorKindsWithLatestWorkflowContext', async () => {
      const pool = createMockPool();
      pool.query.mockResolvedValue({
        rows: [
          {
            actor_kind: 'specialist_agent',
            actor_id: null,
            actor_name: null,
            count: '45',
            latest_role: 'developer',
            latest_workflow_id: 'wf-1',
            latest_workflow_name: 'Customer migration',
            latest_workflow_label: 'Customer migration',
          },
        ],
        rowCount: 2,
      });
      const service = new LogService(pool as never);

      const result = await service.actors('tenant-1', {
        since: new Date('2026-03-08T00:00:00Z').toISOString(),
        workflowId: 'wf-1',
        operation: ['tool.exec'],
        role: ['developer'],
      });

      expect(result).toEqual([
        {
          actor_kind: 'specialist_agent',
          actor_id: null,
          actor_name: null,
          count: 45,
          latest_role: 'developer',
          latest_workflow_id: 'wf-1',
          latest_workflow_name: 'Customer migration',
          latest_workflow_label: 'Customer migration',
        },
      ]);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).not.toContain('actor_id IS NOT NULL');
      expect(sql).toContain('ROW_NUMBER() OVER');
      expect(sql).toContain('workflow_id = $');
      expect(sql).toContain('operation = ANY(');
      expect(sql).toContain('role = ANY(');
      expect(sql).toContain('GROUP BY actor_kind');
      expect(params).toContain('wf-1');
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
        .mockResolvedValueOnce({
          rows: [...page1, { id: '99', created_at: '2026-03-09T12:00:04.000Z' }],
          rowCount: 4,
        })
        .mockResolvedValueOnce({ rows: page2, rowCount: 1 });
      const service = new LogService(pool as never);

      const rows: unknown[] = [];
      for await (const row of service.export('tenant-1', { perPage: 3 })) {
        rows.push(row);
      }
      expect(rows).toHaveLength(4);
    });

    it('reuses capped keyset page sizes during large exports', async () => {
      const pool = createMockPool();
      const page1 = Array.from({ length: 501 }, (_, i) => ({
        id: String(i),
        created_at: `2026-03-09T12:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
      }));
      const page2 = [{ id: '999', created_at: '2026-03-09T13:00:00.000Z' }];
      pool.query
        .mockResolvedValueOnce({ rows: page1, rowCount: 501 })
        .mockResolvedValueOnce({ rows: page2, rowCount: 1 });
      const service = new LogService(pool as never);

      const rows: unknown[] = [];
      for await (const row of service.export('tenant-1', { perPage: 9999 })) {
        rows.push(row);
      }

      expect(rows).toHaveLength(501);
      expect(pool.query).toHaveBeenCalledTimes(2);
      const firstParams = pool.query.mock.calls[0]?.[1] as unknown[];
      const secondParams = pool.query.mock.calls[1]?.[1] as unknown[];
      expect(firstParams.at(-1)).toBe(501);
      expect(secondParams.at(-1)).toBe(501);
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
