import { describe, expect, it, vi } from 'vitest';

import { readCookieValue, resolveAuthCallbackSession } from './auth-callback.js';

describe('auth callback session bootstrap', () => {
  it('reads cookie values by name from the browser cookie header', () => {
    expect(
      readCookieValue('theme=dark; agirunner_csrf_token=csrf-token; other=value', 'agirunner_csrf_token'),
    ).toBe('csrf-token');
    expect(readCookieValue('theme=dark', 'agirunner_csrf_token')).toBeNull();
  });

  it('uses the active access cookie when auth/me succeeds', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              tenant_id: 'tenant-42',
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;

    await expect(
      resolveAuthCallbackSession({
        apiBaseUrl: 'http://localhost:8080',
        fetcher,
      }),
    ).resolves.toEqual({
      tenantId: 'tenant-42',
      accessToken: null,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/auth/me',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
  });

  it('refreshes the browser session when auth/me returns 401 after redirect', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              token: 'fresh-token',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              tenant_id: 'tenant-42',
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;

    await expect(
      resolveAuthCallbackSession({
        apiBaseUrl: 'http://localhost:8080',
        cookieHeader: 'agirunner_csrf_token=csrf-token',
        fetcher,
      }),
    ).resolves.toEqual({
      tenantId: 'tenant-42',
      accessToken: 'fresh-token',
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v1/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: {
          'x-csrf-token': 'csrf-token',
        },
      }),
    );
  });

  it('fails when the callback cannot authenticate and no refresh CSRF cookie is available', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 })) as unknown as typeof fetch;

    await expect(
      resolveAuthCallbackSession({
        apiBaseUrl: 'http://localhost:8080',
        fetcher,
      }),
    ).rejects.toThrow('HTTP 401');
  });
});
