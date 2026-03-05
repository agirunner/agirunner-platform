import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/auth/api-key.js', () => ({
  createApiKey: vi.fn(),
}));

import { createApiKey } from '../../src/auth/api-key.js';
import { registerWorker } from '../../src/services/worker-registration-service.js';

const mockedCreateApiKey = vi.mocked(createApiKey);

describe('worker registration service internal runtime bootstrap', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('auto-creates one internal agent when runtime_type is internal and no agents are supplied', async () => {
    mockedCreateApiKey
      .mockResolvedValueOnce({ apiKey: 'worker-api-key', keyPrefix: 'wk-prefix' })
      .mockResolvedValueOnce({ apiKey: 'agent-api-key', keyPrefix: 'ag-prefix' });

    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('INSERT INTO workers')) {
          return {
            rowCount: 1,
            rows: [{ id: 'worker-1', name: 'internal-worker', heartbeat_interval_seconds: 30 }],
          };
        }
        if (sql.includes('INSERT INTO agents')) {
          expect(params[2]).toBe('internal-worker-agent');
          expect(params[3]).toEqual(['go', 'testing']);
          expect(params[5]).toMatchObject({
            auto_created: true,
            creation_source: 'worker_registration_internal_runtime',
          });
          return {
            rowCount: 1,
            rows: [{ id: 'agent-1', name: 'internal-worker-agent', capabilities: ['go', 'testing'] }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    const eventService = { emit: vi.fn() };
    const context = {
      pool,
      eventService,
      config: {
        WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: 30,
        WORKER_API_KEY_TTL_MS: 60_000,
        AGENT_API_KEY_TTL_MS: 60_000,
        WORKER_WEBSOCKET_PATH: '/api/v1/events',
      },
    };

    const identity = {
      id: 'admin-key',
      tenantId: 'tenant-1',
      scope: 'admin' as const,
      ownerType: 'user',
      ownerId: null,
      keyPrefix: 'admin',
    };

    const result = await registerWorker(context as never, identity as never, {
      name: 'internal-worker',
      runtime_type: 'internal',
      connection_mode: 'polling',
      capabilities: ['go', 'testing'],
    });

    expect(result.worker_id).toBe('worker-1');
    expect(result.worker_api_key).toBe('worker-api-key');
    expect(result.agents).toEqual([
      {
        id: 'agent-1',
        name: 'internal-worker-agent',
        capabilities: ['go', 'testing'],
        api_key: 'agent-api-key',
      },
    ]);
    expect(mockedCreateApiKey).toHaveBeenCalledTimes(2);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'worker.registered', entityId: 'worker-1' }),
    );
  });
});
