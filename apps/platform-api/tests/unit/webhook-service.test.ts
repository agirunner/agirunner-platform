import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebhookService } from '../../src/services/webhook-service.js';

const event = {
  id: 1,
  tenant_id: '00000000-0000-0000-0000-000000000001',
  type: 'task.completed',
  entity_type: 'task',
  entity_id: 'task-1',
  actor_type: 'system',
  actor_id: 'test-runner',
  data: { ok: true },
  created_at: new Date().toISOString(),
};

describe('WebhookService delivery behavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks delivery failed after retry exhaustion', async () => {
    const updateCalls: unknown[][] = [];
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('SELECT id, url, secret, event_types')) {
          return {
            rows: [{ id: 'hook-1', url: 'https://hooks.example.com', secret: 'secret', event_types: [] }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO webhook_deliveries')) {
          return { rows: [{ id: 'delivery-1' }], rowCount: 1 };
        }
        if (sql.includes('UPDATE webhook_deliveries')) {
          updateCalls.push(params);
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    const fetchMock = vi.fn(async () => new Response('fail', { status: 500 })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const service = new WebhookService(pool as never, {
      WEBHOOK_MAX_ATTEMPTS: 3,
      WEBHOOK_RETRY_BASE_DELAY_MS: 1,
    } as never);

    await service.deliverEvent(event);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][3]).toBe(3);
    expect(updateCalls[0][4]).toBe('failed');
    expect(updateCalls[0][5]).toBe(500);
    expect(String(updateCalls[0][6])).toContain('HTTP 500');
  });

  it('records timeout/network errors as failed webhook deliveries', async () => {
    const updateCalls: unknown[][] = [];
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('SELECT id, url, secret, event_types')) {
          return {
            rows: [{ id: 'hook-1', url: 'https://hooks.example.com', secret: 'secret', event_types: [] }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO webhook_deliveries')) {
          return { rows: [{ id: 'delivery-1' }], rowCount: 1 };
        }
        if (sql.includes('UPDATE webhook_deliveries')) {
          updateCalls.push(params);
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    const fetchMock = vi
      .fn(async () => {
        throw new Error('network timeout');
      })
      .mockName('fetch') as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);

    const service = new WebhookService(pool as never, {
      WEBHOOK_MAX_ATTEMPTS: 1,
      WEBHOOK_RETRY_BASE_DELAY_MS: 1,
    } as never);

    await service.deliverEvent(event);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updateCalls[0][3]).toBe(1);
    expect(updateCalls[0][4]).toBe('failed');
    expect(updateCalls[0][5]).toBeNull();
    expect(String(updateCalls[0][6])).toContain('network timeout');
  });
});
