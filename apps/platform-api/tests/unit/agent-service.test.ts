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
        secret_ref: 'secret:AGENT_PROFILE',
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
            safe: 'visible',
          },
        },
      },
    ]);
  });
});
