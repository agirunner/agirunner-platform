import { describe, expect, it, vi } from 'vitest';

import { IntegrationAdapterService } from '../../src/services/integration-adapter-service.js';

const encryptionKey = 'k'.repeat(64);
const deliveryEvent = {
  id: 17,
  tenant_id: 'tenant-1',
  type: 'task.completed',
  entity_type: 'task',
  entity_id: 'task-1',
  actor_type: 'system',
  actor_id: null,
  data: { pipeline_id: 'pipeline-1' },
  created_at: new Date().toISOString(),
};

describe('IntegrationAdapterService', () => {
  it('masks stored webhook secrets when listing adapters', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'adapter-1',
            tenant_id: 'tenant-1',
            pipeline_id: null,
            kind: 'webhook',
            config: {
              url: 'https://example.com/hooks',
              headers: { 'x-test': 'true' },
              secret: 'enc:v1:masked-secret',
            },
            subscriptions: ['task.*'],
            is_active: true,
            created_at: new Date('2026-03-06T00:00:00Z'),
            updated_at: new Date('2026-03-06T00:00:00Z'),
          },
        ],
      }),
    };
    const service = new IntegrationAdapterService(
      pool as never,
      {
        WEBHOOK_ENCRYPTION_KEY: encryptionKey,
        WEBHOOK_MAX_ATTEMPTS: 1,
        WEBHOOK_RETRY_BASE_DELAY_MS: 1,
      } as never,
      vi.fn(),
    );

    const adapters = await service.listAdapters('tenant-1');

    expect(adapters).toHaveLength(1);
    expect(adapters[0].config).toEqual({
      url: 'https://example.com/hooks',
      headers: { 'x-test': 'true' },
      secret_configured: true,
    });
  });

  it('records successful integration adapter deliveries', async () => {
    const queries: string[] = [];
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const pool = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('FROM integration_adapters')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'adapter-1',
                tenant_id: 'tenant-1',
                pipeline_id: null,
                kind: 'webhook',
                config: {
                  url: 'https://example.com/hooks',
                  headers: { 'x-test': 'true' },
                },
                subscriptions: ['task.*'],
                is_active: true,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes('INSERT INTO integration_adapter_deliveries')) {
          return { rowCount: 1, rows: [{ id: 'delivery-1' }] };
        }
        if (sql.includes('UPDATE integration_adapter_deliveries')) {
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }),
    };
    const service = new IntegrationAdapterService(
      pool as never,
      {
        WEBHOOK_ENCRYPTION_KEY: encryptionKey,
        WEBHOOK_MAX_ATTEMPTS: 2,
        WEBHOOK_RETRY_BASE_DELAY_MS: 1,
      } as never,
      fetchFn,
    );

    await service.deliverEvent(deliveryEvent);

    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.com/hooks',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-agentbaton-event': 'task.completed',
          'x-test': 'true',
        }),
      }),
    );
    expect(queries.some((sql) => sql.includes('INSERT INTO integration_adapter_deliveries'))).toBe(true);
    expect(queries.some((sql) => sql.includes('UPDATE integration_adapter_deliveries'))).toBe(true);
  });
});
