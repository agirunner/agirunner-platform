import { describe, expect, it } from 'vitest';

import { LogService } from '../../../../../src/logging/execution/log-service.js';
import { createMockPool } from './support.js';

describe('Logging E2E Verification - ingest round trip', () => {
  it('insertsEntryWithAllFieldsPreserved', async () => {
    const pool = createMockPool();
    const service = new LogService(pool as never);

    await service.insert({
      tenantId: 'tenant-1',
      traceId: 'trace-abc',
      spanId: 'span-def',
      parentSpanId: 'span-parent',
      source: 'runtime',
      category: 'llm',
      level: 'info',
      operation: 'llm.chat_stream',
      status: 'completed',
      durationMs: 1500,
      payload: { model: 'claude-opus', input_tokens: 500, output_tokens: 200 },
      workspaceId: 'proj-1',
      workflowId: 'wf-1',
      taskId: 'task-1',
      workItemId: 'work-item-1',
      stageName: 'implementation',
      activationId: 'activation-1',
      isOrchestratorTask: true,
      actorType: 'worker',
      actorId: 'w-1',
      actorName: 'worker-01',
      resourceType: 'llm_provider',
      resourceId: '00000000-0000-0000-0000-000000000010',
      resourceName: 'Anthropic',
    });

    expect(pool.rows).toHaveLength(1);
    const row = pool.rows[0];
    expect(row.tenant_id).toBe('tenant-1');
    expect(row.source).toBe('runtime');
    expect(row.category).toBe('llm');
    expect(row.operation).toBe('llm.chat_stream');
    expect(row.duration_ms).toBe(1500);
    expect(row.payload).toEqual({ model: 'claude-opus', input_tokens: 500, output_tokens: 200 });
    expect(row.work_item_id).toBe('work-item-1');
    expect(row.stage_name).toBe('implementation');
    expect(row.activation_id).toBe('activation-1');
    expect(row.is_orchestrator_task).toBe(true);
    expect(row.actor_type).toBe('worker');
    expect(row.resource_type).toBe('llm_provider');
  });

  it('redactsSecretsInPayloadOnInsert', async () => {
    const pool = createMockPool();
    const service = new LogService(pool as never);

    await service.insert({
      tenantId: 'tenant-1',
      traceId: 'trace-1',
      spanId: 'span-1',
      source: 'platform',
      category: 'auth',
      level: 'info',
      operation: 'auth.login',
      status: 'completed',
      payload: { api_key: 'sk-secret-value', username: 'mark', password: 'hunter2' },
    });

    const row = pool.rows[0];
    expect(row.payload).toEqual({
      api_key: '[REDACTED]',
      username: 'mark',
      password: '[REDACTED]',
    });
  });

  it('batchInsertAcceptsMultipleEntries', async () => {
    const pool = createMockPool();
    const service = new LogService(pool as never);

    const result = await service.insertBatch([
      {
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'container_manager',
        category: 'container',
        level: 'info',
        operation: 'container.create',
        status: 'completed',
      },
      {
        tenantId: 'tenant-1',
        traceId: 'trace-2',
        spanId: 'span-2',
        source: 'container_manager',
        category: 'container',
        level: 'error',
        operation: 'container.create',
        status: 'failed',
        error: { message: 'no space left' },
      },
    ]);

    expect(result.accepted).toBe(2);
    expect(result.rejected).toBe(0);
    expect(pool.rows).toHaveLength(2);
    expect(pool.rows[0].operation).toBe('container.create');
    expect(pool.rows[1].status).toBe('failed');
  });
});
