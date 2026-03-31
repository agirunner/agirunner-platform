import { describe, expect, it, vi } from 'vitest';

import { LogService } from '../../../src/logging/log-service.js';
import {
  createDeferred,
  createLogEntry,
  createLogServiceHarness,
  createMockPool,
  getInsertCall,
  getPartitionCalls,
} from './support.js';

describe('LogService', () => {
  describe('insert', () => {
    it('insertsLogEntryWithAllFields', async () => {
      const { pool, service } = createLogServiceHarness();

      await service.insert(createLogEntry({
        parentSpanId: 'parent-1',
        operation: 'api.get.workspaces',
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
      }));

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
      const { pool, service } = createLogServiceHarness();

      await service.insert(createLogEntry({
        source: 'runtime',
        category: 'llm',
        operation: 'llm.chat_stream',
      }));

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
      const { pool, service } = createLogServiceHarness();

      await service.insert(createLogEntry({
        category: 'task_lifecycle',
        operation: 'task_lifecycle.task.created',
        workflowId: 'wf-1',
        taskId: 'task-1',
        workItemId: 'work-item-1',
        activationId: 'activation-1',
        stageName: 'implementation',
        isOrchestratorTask: true,
      }));

      const [, params] = getInsertCall(pool)!;
      expect(params[17]).toBe('work-item-1');
      expect(params[18]).toBe('activation-1');
      expect(params[20]).toBe('implementation');
      expect(params[21]).toBe(true);
    });

    it('serializesMetadataAsJson', async () => {
      const { pool, service } = createLogServiceHarness();

      await service.insert(createLogEntry({
        category: 'config',
        operation: 'config.llm_config.created',
        payload: { provider: 'openai', model: 'gpt-4.1-mini' },
      }));

      const [, params] = getInsertCall(pool)!;
      expect(params[10]).toBe('{"provider":"openai","model":"gpt-4.1-mini"}');
    });

    it('redacts embedded token-like secrets inside longer prose before insert', async () => {
      const { pool, service } = createLogServiceHarness();

      await service.insert(createLogEntry({
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
      }));

      const [, params] = getInsertCall(pool)!;
      expect(params[10]).toBe('{"detail":"[REDACTED]"}');
      expect(params[11]).toBe('{"code":"AUTH_FAILED","message":"[REDACTED]"}');
    });

    it('serializesErrorAsJson', async () => {
      const { pool, service } = createLogServiceHarness();

      await service.insert(createLogEntry({
        level: 'error',
        operation: 'api.post.workflows',
        status: 'failed',
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input' },
      }));

      const [, params] = getInsertCall(pool)!;
      const errorJson = JSON.parse(params[11] as string);
      expect(errorJson.code).toBe('VALIDATION_ERROR');
      expect(errorJson.message).toBe('Invalid input');
    });

    it('ensuresPartitionOnlyOncePerDate', async () => {
      const { pool, service } = createLogServiceHarness();

      await service.insert(createLogEntry({
        operation: 'api.first',
        createdAt: '2026-03-12T11:28:01.888699Z',
      }));
      await service.insert(createLogEntry({
        traceId: 'trace-2',
        spanId: 'span-2',
        operation: 'api.second',
        createdAt: '2026-03-12T12:00:00.000Z',
      }));

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

      await service.insert(createLogEntry({
        operation: 'api.partition-race',
        createdAt: '2026-03-13T11:28:01.888699Z',
      }));

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

      await service.insert(createLogEntry({
        operation: 'api.partition-race-duplicate-object',
        createdAt: '2026-03-13T11:28:01.888699Z',
      }));

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

      await service.insert(createLogEntry({
        operation: 'api.partition-race-object',
        createdAt: '2026-03-13T11:28:01.888699Z',
      }));

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

      const firstInsert = service.insert(createLogEntry({
        operation: 'api.concurrent-first',
        createdAt: '2026-03-13T11:28:01.888699Z',
      }));
      const secondInsert = service.insert(createLogEntry({
        traceId: 'trace-2',
        spanId: 'span-2',
        operation: 'api.concurrent-second',
        createdAt: '2026-03-13T12:28:01.888699Z',
      }));

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
        .mockRejectedValueOnce(new Error('no partition of relation "execution_logs" found for row'))
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });
      const service = new LogService(pool as never);

      await service.insert(createLogEntry({
        operation: 'api.retry',
        createdAt: '2026-03-12T11:28:01.888699Z',
      }));

      expect(getPartitionCalls(pool)).toHaveLength(2);
      expect(pool.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO execution_logs'))).toHaveLength(2);
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

      await service.insert(createLogEntry({
        operation: 'api.retry-plain-object',
        createdAt: '2026-03-12T11:28:01.888699Z',
      }));

      expect(getPartitionCalls(pool)).toHaveLength(2);
      expect(pool.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO execution_logs'))).toHaveLength(2);
    });
  });
});
