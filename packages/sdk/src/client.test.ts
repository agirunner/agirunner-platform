import { describe, expect, it, vi } from 'vitest';

import { PlatformApiClient, PlatformApiError } from './client.js';

describe('PlatformApiClient', () => {
  it('returns null when claim endpoint responds with 204', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(undefined, {
        status: 204,
      }),
    ) as unknown as typeof fetch;

    const client = new PlatformApiClient({
      baseUrl: 'http://localhost:8080',
      accessToken: 'jwt-token',
      fetcher,
    });

    const task = await client.claimTask({
      agent_id: 'agent-id',
      capabilities: [],
    });

    expect(task).toBeNull();
  });

  it('includes auth header for authenticated requests', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'task-1',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ) as unknown as typeof fetch;

    const client = new PlatformApiClient({
      baseUrl: 'http://localhost:8080',
      accessToken: 'jwt-token',
      fetcher,
    });

    await client.getTask('task-1');

    const [, options] = vi.mocked(fetcher).mock.calls[0];
    const headers = options?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-token');
  });

  it.each([401, 403, 404, 500])('throws PlatformApiError for HTTP %s responses', async (statusCode) => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'failure' }), {
        status: statusCode,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const client = new PlatformApiClient({
      baseUrl: 'http://localhost:8080',
      accessToken: 'jwt-token',
      fetcher,
    });

    await expect(client.getTask('task-1')).rejects.toMatchObject({
      name: 'PlatformApiError',
      status: statusCode,
    });
  });

  it('paginates through all pages using helper', async () => {
    const client = new PlatformApiClient({
      baseUrl: 'http://localhost:8080',
      accessToken: 'jwt-token',
      fetcher: vi.fn() as unknown as typeof fetch,
    });

    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: 'a' }, { id: 'b' }],
        pagination: { page: 1, per_page: 2, total: 3, total_pages: 2 },
      })
      .mockResolvedValueOnce({
        data: [{ id: 'c' }],
        pagination: { page: 2, per_page: 2, total: 3, total_pages: 2 },
      });

    const rows = await client.paginate(fetchPage, { perPage: 2 });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, { page: 1, per_page: 2 });
    expect(fetchPage).toHaveBeenNthCalledWith(2, { page: 2, per_page: 2 });
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });

  it('default fetcher remains callable when global fetch requires receiver binding', async () => {
    const originalFetch = globalThis.fetch;

    let fetchCallCount = 0;
    const boundFetch = function (this: typeof globalThis, _input: RequestInfo | URL, _init?: RequestInit) {
      fetchCallCount += 1;
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }

      return Promise.resolve(
        new Response(JSON.stringify({ data: { token: 'token', tenant_id: 'tenant', scope: 'admin' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    };

    globalThis.fetch = boundFetch as unknown as typeof fetch;

    try {
      const client = new PlatformApiClient({
        baseUrl: 'http://localhost:8080',
      });

      await expect(client.exchangeApiKey('ar_admin_defintegrationlane0000000000001')).resolves.toEqual({
        token: 'token',
        tenant_id: 'tenant',
        scope: 'admin',
      });
      expect(fetchCallCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('builds grouped workflow work-item query strings for list and detail reads', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: 'wi-parent', children_count: 2, is_milestone: true }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: 'wi-parent', children: [{ id: 'wi-child-1' }] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ) as unknown as typeof fetch;

    const client = new PlatformApiClient({
      baseUrl: 'http://localhost:8080',
      accessToken: 'jwt-token',
      fetcher,
    });

    await client.listWorkflowWorkItems('wf-1', {
      parent_work_item_id: 'wi-root',
      stage_name: 'implementation',
      column_id: 'active',
      grouped: true,
    });
    await client.getWorkflowWorkItem('wf-1', 'wi-parent', { include_children: true });

    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe(
      'http://localhost:8080/api/v1/workflows/wf-1/work-items?parent_work_item_id=wi-root&stage_name=implementation&column_id=active&grouped=true',
    );
    expect(vi.mocked(fetcher).mock.calls[1]?.[0]).toBe(
      'http://localhost:8080/api/v1/workflows/wf-1/work-items/wi-parent?include_children=true',
    );
  });
});
