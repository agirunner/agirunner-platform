import { describe, expect, it, vi } from 'vitest';

import { PlatformApiClient } from './client.js';

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
});
