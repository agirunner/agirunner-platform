import { describe, expect, it } from 'vitest';

import {
  createBatchEntries,
  createLogEntry,
  createLogServiceHarness,
  createMockPool,
  getInsertCall,
  getPartitionCalls,
} from './logging-log-service-support.js';
import { LogService } from '../../src/logging/log-service.js';

describe('LogService', () => {
  describe('insertBatch', () => {
    it('insertsMultipleEntriesAndReturnsAcceptedCount', async () => {
      const { pool, service } = createLogServiceHarness();

      const result = await service.insertBatch(
        createBatchEntries(3, {
          source: 'runtime',
          category: 'llm',
          operation: 'llm.chat_stream',
        }),
      );

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

      const result = await service.insertBatch(
        createBatchEntries(3, {
          source: 'runtime',
          category: 'llm',
          operation: 'llm.chat_stream',
        }),
      );

      expect(result).toEqual({
        accepted: 2,
        rejected: 1,
        rejection_details: [{
          index: 0,
          trace_id: 'trace-0',
          operation: 'llm.chat_stream',
          reason: 'constraint violation',
        }],
      });
    });

    it('returnsZerosForEmptyBatch', async () => {
      const { pool, service } = createLogServiceHarness();
      const result = await service.insertBatch([]);
      expect(result).toEqual({ accepted: 0, rejected: 0, rejection_details: [] });
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('capsAtMaxBatchSize', async () => {
      const { pool, service } = createLogServiceHarness();

      const result = await service.insertBatch(
        createBatchEntries(120, {
          source: 'runtime',
          category: 'llm',
          operation: 'llm.chat_stream',
        }),
      );

      expect(result.accepted).toBe(100);
      expect(getPartitionCalls(pool)).toHaveLength(1);
      expect(pool.query).toHaveBeenCalledTimes(101);
    });

    it('redactsSecretKeysOnDirectInsert', async () => {
      const { pool, service } = createLogServiceHarness();

      await service.insert(createLogEntry({
        category: 'config',
        operation: 'config.provider.created',
        payload: {
          api_key: 'sk-secret-value',
          safe_field: 'visible',
        },
      }));

      const [, params] = getInsertCall(pool)!;
      const payload = JSON.parse(params[10] as string);
      expect(payload.api_key).toBe('[REDACTED]');
      expect(payload.safe_field).toBe('visible');
    });

    it('redactsSecretKeysInBatchInsert', async () => {
      const { pool, service } = createLogServiceHarness();

      await service.insertBatch([
        createLogEntry({
          source: 'runtime',
          category: 'tool',
          operation: 'tool.shell_exec',
          payload: {
            api_key: 'sk-secret-value',
            password: 'my-password',
            safe_field: 'visible',
            tokens_in: 200,
            tokens_out: 150,
            total_tokens: 350,
            nested: { secret_token: 'tok-123', name: 'safe' },
          },
        }),
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
      const { pool, service } = createLogServiceHarness();

      await service.insertBatch([
        createLogEntry({
          source: 'runtime',
          category: 'tool',
          operation: 'tool.shell_exec',
          payload: {
            input: 'export API_KEY=sk-abc123',
            output: 'success',
          },
        }),
      ]);

      const [, params] = getInsertCall(pool)!;
      const payload = JSON.parse(params[10] as string);
      expect(payload.input).toBe('[REDACTED]');
      expect(payload.output).toBe('success');
    });
  });
});
