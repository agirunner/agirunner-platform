import { describe, expect, it, vi } from 'vitest';

import { IntegrationAdapterService } from '../../src/services/integration-adapter-service.js';
import { encryptWebhookSecret } from '../../src/services/webhook-secret-crypto.js';

const encryptionKey = 'k'.repeat(64);
const deliveryEvent = {
  id: 17,
  tenant_id: 'tenant-1',
  type: 'task.completed',
  entity_type: 'task',
  entity_id: 'task-1',
  actor_type: 'system',
  actor_id: null,
  data: { workflow_id: 'workflow-1' },
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
            workflow_id: null,
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

  it('redacts secret-bearing webhook header values when listing adapters', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'adapter-1',
            tenant_id: 'tenant-1',
            workflow_id: null,
            kind: 'webhook',
            config: {
              url: 'https://example.com/hooks',
              headers: {
                Authorization: encryptWebhookSecret('Bearer top-secret', encryptionKey),
                'x-safe': 'true',
              },
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

    expect(adapters[0]?.config).toEqual({
      url: 'https://example.com/hooks',
      headers: {
        Authorization: 'redacted://integration-header-secret',
        'x-safe': 'true',
      },
      secret_configured: true,
    });
  });

  it('redacts slack webhook urls and otlp auth headers in public adapter views', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 2,
        rows: [
          {
            id: 'adapter-slack',
            tenant_id: 'tenant-1',
            workflow_id: null,
            kind: 'slack',
            config: {
              webhook_url: encryptWebhookSecret('https://hooks.slack.com/services/TOKEN', encryptionKey),
              channel: '#alerts',
            },
            subscriptions: ['task.*'],
            is_active: true,
            created_at: new Date('2026-03-06T00:00:00Z'),
            updated_at: new Date('2026-03-06T00:00:00Z'),
          },
          {
            id: 'adapter-otlp',
            tenant_id: 'tenant-1',
            workflow_id: null,
            kind: 'otlp_http',
            config: {
              endpoint: 'https://otlp.example.com/v1/traces',
              headers: {
                authorization: encryptWebhookSecret('Bearer otlp-secret', encryptionKey),
                'x-safe': 'true',
              },
              service_name: 'agirunner',
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

    expect(adapters[0]?.config).toEqual({
      webhook_url_configured: true,
      channel: '#alerts',
    });
    expect(adapters[1]?.config).toEqual({
      endpoint: 'https://otlp.example.com/v1/traces',
      headers: {
        authorization: 'redacted://integration-header-secret',
        'x-safe': 'true',
      },
      service_name: 'agirunner',
    });
  });

  it('migrates plaintext stored webhook adapter secrets and headers during public reads', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'adapter-legacy',
            tenant_id: 'tenant-1',
            workflow_id: null,
            kind: 'webhook',
            config: {
              url: 'https://example.com/hooks',
              secret: 'legacy-webhook-secret',
              headers: {
                Authorization: 'Bearer legacy-secret',
                'x-safe': 'true',
              },
            },
            subscriptions: ['task.*'],
            is_active: true,
            created_at: new Date('2026-03-06T00:00:00Z'),
            updated_at: new Date('2026-03-06T00:00:00Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const service = new IntegrationAdapterService(
      { query } as never,
      {
        WEBHOOK_ENCRYPTION_KEY: encryptionKey,
        WEBHOOK_MAX_ATTEMPTS: 1,
        WEBHOOK_RETRY_BASE_DELAY_MS: 1,
      } as never,
      vi.fn(),
    );

    const adapters = await service.listAdapters('tenant-1');

    expect(adapters[0]?.config).toEqual({
      url: 'https://example.com/hooks',
      headers: {
        Authorization: 'redacted://integration-header-secret',
        'x-safe': 'true',
      },
      secret_configured: true,
    });
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE integration_adapters'),
      [
        'tenant-1',
        'adapter-legacy',
        expect.objectContaining({
          url: 'https://example.com/hooks',
          secret: expect.stringMatching(/^enc:v\d+:/),
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^enc:v\d+:/),
            'x-safe': 'true',
          }),
        }),
      ],
    );
  });

  it('migrates plaintext stored webhook adapter secrets before delivery', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM integration_adapters')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'adapter-legacy',
              tenant_id: 'tenant-1',
              workflow_id: null,
              kind: 'webhook',
              config: {
                url: 'https://example.com/hooks',
                secret: 'legacy-webhook-secret',
                headers: {
                  Authorization: 'Bearer legacy-secret',
                },
              },
              subscriptions: ['task.*'],
              is_active: true,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        };
      }
      if (sql.includes('UPDATE integration_adapters')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('INSERT INTO integration_adapter_deliveries')) {
        return { rowCount: 1, rows: [{ id: 'delivery-1' }] };
      }
      if (sql.includes('UPDATE integration_adapter_deliveries')) {
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });
    const service = new IntegrationAdapterService(
      { query } as never,
      {
        WEBHOOK_ENCRYPTION_KEY: encryptionKey,
        WEBHOOK_MAX_ATTEMPTS: 1,
        WEBHOOK_RETRY_BASE_DELAY_MS: 1,
      } as never,
      fetchFn,
    );

    await service.deliverEvent(deliveryEvent);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE integration_adapters'),
      [
        'tenant-1',
        'adapter-legacy',
        expect.objectContaining({
          secret: expect.stringMatching(/^enc:v\d+:/),
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^enc:v\d+:/),
          }),
        }),
      ],
    );
    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.com/hooks',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer legacy-secret',
          'x-agirunner-signature': expect.any(String),
        }),
      }),
    );
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
                workflow_id: null,
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
          'x-agirunner-event': 'task.completed',
          'x-test': 'true',
        }),
      }),
    );
    expect(queries.some((sql) => sql.includes('INSERT INTO integration_adapter_deliveries'))).toBe(true);
    expect(queries.some((sql) => sql.includes('UPDATE integration_adapter_deliveries'))).toBe(true);
  });

  it('decrypts stored slack webhook urls only for delivery', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM integration_adapters')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'adapter-slack',
                tenant_id: 'tenant-1',
                workflow_id: null,
                kind: 'slack',
                config: {
                  webhook_url: encryptWebhookSecret('https://hooks.slack.com/services/REAL', encryptionKey),
                  channel: '#alerts',
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
        WEBHOOK_MAX_ATTEMPTS: 1,
        WEBHOOK_RETRY_BASE_DELAY_MS: 1,
      } as never,
      fetchFn,
    );

    await service.deliverEvent(deliveryEvent);

    expect(fetchFn).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/REAL',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('decrypts encrypted webhook and otlp headers only for delivery', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 202 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM integration_adapters')) {
          return {
            rowCount: 2,
            rows: [
              {
                id: 'adapter-webhook',
                tenant_id: 'tenant-1',
                workflow_id: null,
                kind: 'webhook',
                config: {
                  url: 'https://example.com/hooks',
                  headers: {
                    Authorization: encryptWebhookSecret('Bearer delivery-secret', encryptionKey),
                    'x-safe': 'true',
                  },
                },
                subscriptions: ['task.*'],
                is_active: true,
                created_at: new Date(),
                updated_at: new Date(),
              },
              {
                id: 'adapter-otlp',
                tenant_id: 'tenant-1',
                workflow_id: null,
                kind: 'otlp_http',
                config: {
                  endpoint: 'https://otlp.example.com/v1/traces',
                  headers: {
                    authorization: encryptWebhookSecret('Bearer otlp-delivery-secret', encryptionKey),
                  },
                  service_name: 'agirunner',
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
        WEBHOOK_MAX_ATTEMPTS: 1,
        WEBHOOK_RETRY_BASE_DELAY_MS: 1,
      } as never,
      fetchFn,
    );

    await service.deliverEvent(deliveryEvent);

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      'https://example.com/hooks',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer delivery-secret',
          'x-agirunner-event': 'task.completed',
          'x-safe': 'true',
        }),
      }),
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      'https://otlp.example.com/v1/traces',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer otlp-delivery-secret',
          'content-type': 'application/json',
        }),
      }),
    );
  });

  it('preserves redacted secret headers when updating an adapter', async () => {
    const preservedSecretHeader = encryptWebhookSecret('Bearer keep-me', encryptionKey);
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'adapter-1',
            tenant_id: 'tenant-1',
            workflow_id: null,
            kind: 'webhook',
            config: {
              url: 'https://example.com/hooks',
              headers: {
                Authorization: preservedSecretHeader,
                'x-safe': 'true',
              },
              secret: 'enc:v1:masked-secret',
            },
            subscriptions: ['task.*'],
            is_active: true,
            created_at: new Date('2026-03-06T00:00:00Z'),
            updated_at: new Date('2026-03-06T00:00:00Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'adapter-1',
            tenant_id: 'tenant-1',
            workflow_id: null,
            kind: 'webhook',
            config: {
              url: 'https://example.com/new-hooks',
              headers: {
                Authorization: preservedSecretHeader,
                'x-safe': 'changed',
              },
              secret: 'enc:v1:masked-secret',
            },
            subscriptions: ['task.*'],
            is_active: true,
            created_at: new Date('2026-03-06T00:00:00Z'),
            updated_at: new Date('2026-03-06T01:00:00Z'),
          },
        ],
      });
    const service = new IntegrationAdapterService(
      { query } as never,
      {
        WEBHOOK_ENCRYPTION_KEY: encryptionKey,
        WEBHOOK_MAX_ATTEMPTS: 1,
        WEBHOOK_RETRY_BASE_DELAY_MS: 1,
      } as never,
      vi.fn(),
    );

    const updated = await service.updateAdapter('tenant-1', 'adapter-1', {
      config: {
        url: 'https://example.com/new-hooks',
        headers: {
          Authorization: 'redacted://integration-header-secret',
          'x-safe': 'changed',
        },
      },
    });

    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE integration_adapters'),
      [
        'tenant-1',
        'adapter-1',
        {
          url: 'https://example.com/new-hooks',
          headers: {
            Authorization: preservedSecretHeader,
            'x-safe': 'changed',
          },
          secret: 'enc:v1:masked-secret',
        },
        null,
        null,
      ],
    );
    expect(updated.config).toEqual({
      url: 'https://example.com/new-hooks',
      headers: {
        Authorization: 'redacted://integration-header-secret',
        'x-safe': 'changed',
      },
      secret_configured: true,
    });
  });
});
