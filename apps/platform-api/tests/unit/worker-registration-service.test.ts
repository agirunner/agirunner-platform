import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/auth/api-key.js', () => ({
  createApiKey: vi.fn(),
}));

import { createApiKey } from '../../src/auth/api-key.js';
import { deleteWorker, getWorker, listWorkers, registerWorker } from '../../src/services/worker-registration-service.js';

const mockedCreateApiKey = vi.mocked(createApiKey);

describe('worker registration service', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers a worker and creates agents from the supplied list', async () => {
    mockedCreateApiKey
      .mockResolvedValueOnce({ apiKey: 'worker-api-key', keyPrefix: 'wk-prefix' })
      .mockResolvedValueOnce({ apiKey: 'agent-api-key', keyPrefix: 'ag-prefix' });

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO workers')) {
          return {
            rowCount: 1,
            rows: [{ id: 'worker-1', name: 'my-runtime', heartbeat_interval_seconds: 30 }],
          };
        }
        if (sql.includes('INSERT INTO agents')) {
          return {
            rowCount: 1,
            rows: [{ id: 'agent-1', name: 'my-runtime-agent', routing_tags: ['coding', 'testing'] }],
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
      name: 'my-runtime',
      runtime_type: 'external',
      connection_mode: 'polling',
      routing_tags: ['coding', 'testing'],
      agents: [{ name: 'my-runtime-agent', routing_tags: ['coding', 'testing'] }],
    });

    expect(result.worker_id).toBe('worker-1');
    expect(result.worker_api_key).toBe('worker-api-key');
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('my-runtime-agent');
    expect(mockedCreateApiKey).toHaveBeenCalledTimes(2);
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'worker.registered', entityId: 'worker-1' }),
    );
  });

  it('creates no agents when agents list is empty', async () => {
    mockedCreateApiKey.mockResolvedValueOnce({ apiKey: 'worker-api-key', keyPrefix: 'wk-prefix' });

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO workers')) {
          return {
            rowCount: 1,
            rows: [{ id: 'worker-2', name: 'bare-worker', heartbeat_interval_seconds: 30 }],
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
      name: 'bare-worker',
      routing_tags: ['general'],
    });

    expect(result.worker_id).toBe('worker-2');
    expect(result.agents).toEqual([]);
    expect(mockedCreateApiKey).toHaveBeenCalledTimes(1);
  });

  it('catches embedded tokens in worker metadata and host info prose on list reads', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'worker-1',
            name: 'my-runtime',
            metadata: {
              notes: 'Forward calls with Bearer sk-live-api-secret for auth.',
              safe: 'no secrets here',
            },
            host_info: {
              env_note: 'Set OPENAI_KEY=sk-proj-1234567890 in the environment.',
              hostname: 'builder-01',
            },
          },
        ],
      }),
    };

    const result = await listWorkers({ pool } as never, 'tenant-1');

    const metadata = result[0].metadata as Record<string, unknown>;
    const hostInfo = result[0].host_info as Record<string, unknown>;

    expect(metadata.notes).toBe('redacted://worker-secret');
    expect(metadata.safe).toBe('no secrets here');
    expect(hostInfo.env_note).toBe('redacted://worker-secret');
    expect(hostInfo.hostname).toBe('builder-01');
  });

  it('redacts secret-bearing worker metadata and host info on list reads', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'worker-1',
            name: 'my-runtime',
            metadata: {
              api_key: 'sk-secret-value',
              nested: {
                authorization: 'Bearer top-secret-token',
                safe: 'visible',
              },
            },
            host_info: {
              token: 'secret:RUNTIME_TOKEN',
              safe_host: 'builder-01',
            },
          },
        ],
      }),
    };

    const result = await listWorkers({ pool } as never, 'tenant-1');

    expect(result).toEqual([
      {
        id: 'worker-1',
        name: 'my-runtime',
        metadata: {
          api_key: 'redacted://worker-secret',
          nested: {
            authorization: 'redacted://worker-secret',
            safe: 'visible',
          },
        },
        host_info: {
          token: 'redacted://worker-secret',
          safe_host: 'builder-01',
        },
      },
    ]);
  });

  it('redacts secret-bearing worker metadata and host info on single-worker reads', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'worker-1',
            name: 'my-runtime',
            metadata: {
              credentials: {
                password: 'plain-secret',
              },
            },
            host_info: {
              headers: {
                authorization: 'Bearer top-secret-token',
              },
            },
          },
        ],
      }),
    };

    const result = await getWorker({ pool } as never, 'tenant-1', 'worker-1');

    expect(result).toEqual({
      id: 'worker-1',
      name: 'my-runtime',
      metadata: {
        credentials: {
          password: 'redacted://worker-secret',
        },
      },
      host_info: {
        headers: {
          authorization: 'redacted://worker-secret',
        },
      },
    });
  });

  it('deletes worker-owned agent keys when a worker is removed', async () => {
    const transactionalQueries: string[] = [];
    let clearedWorkerSignals = false;
    let clearedMessageReferences = false;
    const client = {
      query: vi.fn(async (sql: string) => {
        transactionalQueries.push(sql);
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rowCount: null, rows: [] };
        }
        if (sql.includes('DELETE FROM api_keys')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE agents SET worker_id = NULL')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE tasks SET assigned_worker_id = NULL')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('DELETE FROM worker_signals')) {
          clearedWorkerSignals = true;
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE orchestrator_task_messages')) {
          clearedMessageReferences = true;
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('DELETE FROM workers')) {
          if (!clearedWorkerSignals || !clearedMessageReferences) {
            throw new Error('worker references were not cleared before delete');
          }
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unexpected transactional SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workers')) {
          return {
            rowCount: 1,
            rows: [{ id: 'worker-1', name: 'my-runtime', metadata: {}, host_info: {} }],
          };
        }
        throw new Error(`Unexpected pool SQL: ${sql}`);
      }),
      connect: vi.fn(async () => client),
    };

    const context = {
      pool,
      connectionHub: { unregisterWorker: vi.fn() },
      eventService: { emit: vi.fn() },
    };
    const identity = {
      id: 'admin-key',
      tenantId: 'tenant-1',
      scope: 'admin' as const,
      ownerType: 'user',
      ownerId: null,
      keyPrefix: 'admin',
    };

    await deleteWorker(context as never, identity as never, 'worker-1');

    const apiKeyDeleteSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes('DELETE FROM api_keys'));
    const workerSignalDeleteSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes('DELETE FROM worker_signals'));
    const messageCleanupSql = client.query.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes('UPDATE orchestrator_task_messages'));

    expect(apiKeyDeleteSql).toContain('DELETE FROM api_keys');
    expect(apiKeyDeleteSql).toContain('FROM agents');
    expect(workerSignalDeleteSql).toContain('DELETE FROM worker_signals');
    expect(messageCleanupSql).toContain('UPDATE orchestrator_task_messages');
    expect(messageCleanupSql).toContain("worker_unassigned");
    expect(messageCleanupSql).toContain("task_not_in_progress");
    expect(transactionalQueries.at(-2)).toContain('DELETE FROM workers');
    expect(context.connectionHub.unregisterWorker).toHaveBeenCalledWith('worker-1');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
