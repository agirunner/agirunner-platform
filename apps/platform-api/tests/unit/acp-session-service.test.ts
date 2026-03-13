import { describe, expect, it, vi } from 'vitest';

import { AcpSessionService } from '../../src/services/acp-session-service.js';

function createPool() {
  return {
    query: vi.fn(),
  };
}

function createIdentity() {
  return {
    tenantId: 'tenant-1',
    scope: 'agent',
    ownerId: 'agent-1',
    keyPrefix: 'agent-prefix',
  };
}

function createEventService() {
  return {
    emit: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AcpSessionService', () => {
  it('redacts secret-bearing session metadata before persisting and returning create responses', async () => {
    const pool = createPool();
    const eventService = createEventService();
    const service = new AcpSessionService(pool as never, eventService as never);

    pool.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: 'agent-1',
          metadata: { protocol: 'acp', acp: { capabilities: { shell: true } } },
        }],
      })
      .mockResolvedValueOnce({
        rowCount: 0,
        rows: [],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: 'session-1',
          agent_id: 'agent-1',
          worker_id: null,
          workflow_id: null,
          transport: 'stdio',
          mode: 'session',
          status: 'initializing',
          workspace_path: '/tmp/work',
          metadata: {
            token_ref: 'secret:ACP_TOKEN',
            api_key: 'sk-live-secret',
            protocol: 'acp',
            capabilities: { shell: true },
            safe: 'visible',
          },
          last_heartbeat_at: '2026-03-13T12:00:00.000Z',
          created_at: '2026-03-13T12:00:00.000Z',
          updated_at: '2026-03-13T12:00:00.000Z',
        }],
      });

    const result = await service.createOrReuseSession(createIdentity() as never, {
      agent_id: 'agent-1',
      transport: 'stdio',
      mode: 'session',
      workspace_path: '/tmp/work',
      metadata: {
        token_ref: 'secret:ACP_TOKEN',
        api_key: 'sk-live-secret',
        safe: 'visible',
      },
    });

    const insertParams = pool.query.mock.calls[2]?.[1] as unknown[];
    expect(insertParams?.[8]).toEqual({
      token_ref: 'redacted://acp-session-secret',
      api_key: 'redacted://acp-session-secret',
      safe: 'visible',
      protocol: 'acp',
      capabilities: { shell: true },
    });
    expect(result).toEqual(
      expect.objectContaining({
        reused: false,
        metadata: {
          token_ref: 'redacted://acp-session-secret',
          api_key: 'redacted://acp-session-secret',
          safe: 'visible',
          protocol: 'acp',
          capabilities: { shell: true },
        },
      }),
    );
  });

  it('redacts secret-bearing metadata on heartbeat updates and responses', async () => {
    const pool = createPool();
    const eventService = createEventService();
    const service = new AcpSessionService(pool as never, eventService as never);

    pool.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: 'session-1',
          agent_id: 'agent-1',
          metadata: {},
        }],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: 'session-1',
          agent_id: 'agent-1',
          worker_id: null,
          workflow_id: null,
          transport: 'stdio',
          mode: 'session',
          status: 'active',
          workspace_path: null,
          metadata: {
            authorization: 'Bearer top-secret',
            secret_ref: 'secret:ACP_HEARTBEAT',
            safe: 'visible',
          },
          last_heartbeat_at: '2026-03-13T12:01:00.000Z',
          created_at: '2026-03-13T12:00:00.000Z',
          updated_at: '2026-03-13T12:01:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await service.heartbeat(createIdentity() as never, 'session-1', {
      status: 'active',
      metadata: {
        authorization: 'Bearer top-secret',
        secret_ref: 'secret:ACP_HEARTBEAT',
        safe: 'visible',
      },
    });

    const updateParams = pool.query.mock.calls[1]?.[1] as unknown[];
    expect(updateParams?.[3]).toEqual({
      authorization: 'redacted://acp-session-secret',
      secret_ref: 'redacted://acp-session-secret',
      safe: 'visible',
    });
    expect(result.metadata).toEqual({
      authorization: 'redacted://acp-session-secret',
      secret_ref: 'redacted://acp-session-secret',
      safe: 'visible',
    });
  });

  it('redacts legacy secret-bearing metadata on session readback', async () => {
    const pool = createPool();
    const eventService = createEventService();
    const service = new AcpSessionService(pool as never, eventService as never);

    pool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: 'session-1',
        agent_id: 'agent-1',
        worker_id: null,
        workflow_id: null,
        transport: 'stdio',
        mode: 'session',
        status: 'idle',
        workspace_path: null,
        metadata: {
          token_ref: 'secret:ACP_LEGACY',
          password: 'hunter2',
          safe: 'visible',
        },
        last_heartbeat_at: '2026-03-13T12:01:00.000Z',
        created_at: '2026-03-13T12:00:00.000Z',
        updated_at: '2026-03-13T12:01:00.000Z',
      }],
    });

    const result = await service.getSession('tenant-1', 'session-1');

    expect(result.metadata).toEqual({
      token_ref: 'redacted://acp-session-secret',
      password: 'redacted://acp-session-secret',
      safe: 'visible',
    });
  });
});
