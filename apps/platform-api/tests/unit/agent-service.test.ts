import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/auth/api-key.js', () => ({
  createApiKey: vi.fn(),
}));

import { createApiKey } from '../../src/auth/api-key.js';
import { AgentService } from '../../src/services/agent-service.js';

const mockedCreateApiKey = vi.mocked(createApiKey);

describe('AgentService secret redaction', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('redacts secret-bearing metadata and tools on register responses', async () => {
    mockedCreateApiKey.mockResolvedValueOnce({ apiKey: 'agent-api-key', keyPrefix: 'ag-prefix' });

    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'agent-1',
            name: 'coder-01',
            capabilities: ['llm-api'],
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
      }),
    };
    const service = new AgentService(
      pool as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
      {
        AGENT_HEARTBEAT_GRACE_PERIOD_MS: 60_000,
        AGENT_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: 30,
        AGENT_KEY_EXPIRY_MS: 60_000,
        AGENT_HEARTBEAT_TOLERANCE_MS: 60_000,
      } as never,
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
        capabilities: ['llm-api'],
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
      {
        AGENT_HEARTBEAT_GRACE_PERIOD_MS: 60_000,
        AGENT_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: 30,
        AGENT_KEY_EXPIRY_MS: 60_000,
        AGENT_HEARTBEAT_TOLERANCE_MS: 60_000,
      } as never,
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
});

describe('AgentService heartbeat enforcement', () => {
  it('does not rescan inactive agents that have no task cleanup left', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM agents')) {
          if (sql.includes("status IN ('active', 'idle', 'busy', 'degraded', 'inactive')")) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: 'agent-1',
                  tenant_id: 'tenant-1',
                  status: 'inactive',
                  heartbeat_interval_seconds: 30,
                  last_heartbeat_at: '2026-03-05T00:00:00.000Z',
                  current_task_id: null,
                },
              ],
            };
          }

          return { rowCount: 0, rows: [] };
        }

        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const service = new AgentService(
      pool as never,
      eventService as never,
      {
        AGENT_HEARTBEAT_GRACE_PERIOD_MS: 60_000,
        AGENT_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: 30,
        AGENT_KEY_EXPIRY_MS: 60_000,
        AGENT_HEARTBEAT_TOLERANCE_MS: 60_000,
      } as never,
    );

    const affected = await service.enforceHeartbeatTimeouts(new Date('2026-03-05T00:10:00.000Z'));

    expect(affected).toBe(0);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(eventService.emit).not.toHaveBeenCalled();
  });
});
