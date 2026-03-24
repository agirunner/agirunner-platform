import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/auth/api-key.js', () => ({
  createApiKey: vi.fn(),
}));

import { createApiKey } from '../../src/auth/api-key.js';
import { AgentService } from '../../src/services/agent-service.js';

const mockedCreateApiKey = vi.mocked(createApiKey);
const DEFAULT_AGENT_RUNTIME_DEFAULTS = {
  'platform.agent_default_heartbeat_interval_seconds': '30',
  'platform.agent_heartbeat_grace_period_ms': '60000',
  'platform.agent_heartbeat_threshold_multiplier': '2',
  'platform.agent_key_expiry_ms': '60000',
} satisfies Record<string, string>;

function createAgentPool(
  runtimeDefaults: Record<string, string>,
  handler: (sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: unknown[] }>,
) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM runtime_defaults')) {
        const key = String(params?.[1] ?? '');
        const value = runtimeDefaults[key];
        return value
          ? { rowCount: 1, rows: [{ config_value: value }] }
          : { rowCount: 0, rows: [] };
      }
      return handler(sql, params);
    }),
  };
}

describe('AgentService secret redaction', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('redacts secret-bearing metadata and tools on register responses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T12:00:00.000Z'));
    mockedCreateApiKey.mockResolvedValueOnce({ apiKey: 'agent-api-key', keyPrefix: 'ag-prefix' });

    const pool = createAgentPool(
      {
        ...DEFAULT_AGENT_RUNTIME_DEFAULTS,
        'platform.agent_default_heartbeat_interval_seconds': '45',
        'platform.agent_key_expiry_ms': '90000',
      },
      async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO agents')) {
          expect(params?.[4]).toBe(45);
          return {
            rowCount: 1,
            rows: [
              {
                id: 'agent-1',
                name: 'coder-01',
                routing_tags: ['coding'],
                status: 'active',
                metadata: {
                  api_key: 'sk-secret-value',
                  tools: {
                    required: ['shell'],
                    authorization: 'Bearer top-secret-token',
                  },
                  profile: {
                    secret_ref: 'secret:AGENT_PROFILE',
                  },
                },
              },
            ],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    );
    const service = new AgentService(
      pool as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.registerAgent(
      {
        id: 'admin-key',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      } as never,
      {
        name: 'coder-01',
        routing_tags: ['coding'],
      },
    );

    expect(result.metadata).toEqual({
      api_key: 'redacted://agent-secret',
      tools: {
        required: ['shell'],
        authorization: 'redacted://agent-secret',
      },
      profile: {
        secret_ref: 'redacted://agent-secret',
      },
    });
    expect(result.tools).toEqual({
      required: ['shell'],
      authorization: 'redacted://agent-secret',
    });
    expect(mockedCreateApiKey).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        expiresAt: new Date('2026-03-17T12:01:30.000Z'),
      }),
    );
  });

  it('skips api key issuance for worker-bound orchestrator agents when requested', async () => {
    const pool = createAgentPool(
      DEFAULT_AGENT_RUNTIME_DEFAULTS,
      async (sql: string) => {
        if (sql.includes('INSERT INTO agents')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'agent-1',
                name: 'orchestrator-01',
                routing_tags: ['llm-api', 'orchestrator'],
                status: 'active',
                metadata: {},
              },
            ],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    );
    const service = new AgentService(
      pool as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.registerAgent(
      {
        id: 'admin-key',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'admin',
      } as never,
      {
        name: 'orchestrator-01',
        worker_id: 'worker-1',
        execution_mode: 'orchestrator',
        issue_api_key: false,
      } as never,
    );

    expect(result.api_key).toBeUndefined();
    expect(mockedCreateApiKey).not.toHaveBeenCalled();
  });

  it('catches embedded bearer tokens in agent metadata prose on list reads', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'agent-1',
            name: 'coder-01',
            metadata: {
              instructions: 'Validate output with Bearer sk-live-output-secret if preview fails.',
              safe: 'no secrets here',
            },
          },
        ],
      }),
    };
    const service = new AgentService(
      pool as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.listAgents('tenant-1');

    expect(result[0].metadata.instructions).toBe('redacted://agent-secret');
    expect(result[0].metadata.safe).toBe('no secrets here');
  });

  it('redacts secret-bearing metadata on agent list reads', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'agent-1',
            name: 'coder-01',
            metadata: {
              token: 'plain-secret-token',
              nested: {
                authorization: 'Bearer top-secret-token',
                secret_ref: 'secret:AGENT_SECRET',
                safe: 'visible',
              },
            },
          },
        ],
      }),
    };
    const service = new AgentService(
      pool as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.listAgents('tenant-1');

    expect(result).toEqual([
      {
        id: 'agent-1',
        name: 'coder-01',
        metadata: {
          token: 'redacted://agent-secret',
          nested: {
            authorization: 'redacted://agent-secret',
            secret_ref: 'redacted://agent-secret',
            safe: 'visible',
          },
        },
      },
    ]);
  });

  it('does not require routing_tags to list agents', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'agent-1',
            worker_id: 'worker-1',
            name: 'coder-01',
            status: 'active',
            metadata: {},
            created_at: new Date().toISOString(),
          },
        ],
      }),
    };
    const service = new AgentService(
      pool as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await service.listAgents('tenant-1');

    const sql = pool.query.mock.calls[0]?.[0] as string;
    expect(sql).not.toContain('routing_tags');
  });
});

describe('AgentService heartbeat enforcement', () => {
  it('does not rescan inactive agents that have no task cleanup left', async () => {
    const pool = createAgentPool(
      DEFAULT_AGENT_RUNTIME_DEFAULTS,
      async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM agents')) {
          expect(params?.[1]).toBe(2);
          expect(sql).toContain("status IN ('active', 'idle', 'busy', 'degraded')");
          expect(sql).not.toContain("status = 'inactive'");
          return { rowCount: 0, rows: [] };
        }

        throw new Error(`Unexpected SQL: ${sql}`);
      },
    );
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const service = new AgentService(
      pool as never,
      eventService as never,
    );

    const affected = await service.enforceHeartbeatTimeouts(new Date('2026-03-05T00:10:00.000Z'));

    expect(affected).toBe(0);
    expect(pool.query).toHaveBeenCalledTimes(5);
    expect(eventService.emit).not.toHaveBeenCalled();
  });
});
