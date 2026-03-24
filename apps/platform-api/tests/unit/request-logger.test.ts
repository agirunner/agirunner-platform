import { describe, expect, it, vi } from 'vitest';

import { registerRequestLogger } from '../../src/logging/request-logger.js';

describe('request logger', () => {
  it('strips query strings before writing request log payloads', async () => {
    let onResponseHandler:
      | ((request: Record<string, unknown>, reply: Record<string, unknown>) => Promise<void>)
      | undefined;

    const app = {
      addHook: vi.fn((name: string, handler: typeof onResponseHandler) => {
        if (name === 'onResponse') {
          onResponseHandler = handler;
        }
      }),
    };
    const logService = {
      insert: vi.fn().mockResolvedValue(undefined),
    };

    registerRequestLogger(app as never, logService as never);

    await onResponseHandler?.(
      {
        method: 'GET',
        url: '/auth/callback?access_token=secret-token&refresh_token=refresh-secret',
        id: 'req-1',
        headers: { 'user-agent': 'vitest' },
        routeOptions: { url: '/auth/callback' },
      },
      {
        elapsedTime: 12,
        statusCode: 302,
      },
    );

    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          path: '/auth/callback',
          route: '/auth/callback',
        }),
      }),
    );
  });

  it('uses the route template instead of logging secret-bearing path tokens', async () => {
    let onResponseHandler:
      | ((request: Record<string, unknown>, reply: Record<string, unknown>) => Promise<void>)
      | undefined;

    const app = {
      addHook: vi.fn((name: string, handler: typeof onResponseHandler) => {
        if (name === 'onResponse') {
          onResponseHandler = handler;
        }
      }),
    };
    const logService = {
      insert: vi.fn().mockResolvedValue(undefined),
    };

    registerRequestLogger(app as never, logService as never);

    await onResponseHandler?.(
      {
        method: 'POST',
        url: '/api/v1/integrations/actions/very-secret-token-value',
        id: 'req-2',
        headers: { 'user-agent': 'vitest' },
        routeOptions: { url: '/api/v1/integrations/actions/:token' },
      },
      {
        elapsedTime: 8,
        statusCode: 200,
      },
    );

    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          path: '/api/v1/integrations/actions/:token',
          route: '/api/v1/integrations/actions/:token',
        }),
      }),
    );
  });

  it('logs successful mutating requests at debug instead of info', async () => {
    let onResponseHandler:
      | ((request: Record<string, unknown>, reply: Record<string, unknown>) => Promise<void>)
      | undefined;

    const app = {
      addHook: vi.fn((name: string, handler: typeof onResponseHandler) => {
        if (name === 'onResponse') {
          onResponseHandler = handler;
        }
      }),
    };
    const logService = {
      insert: vi.fn().mockResolvedValue(undefined),
    };

    registerRequestLogger(app as never, logService as never);

    await onResponseHandler?.(
      {
        method: 'POST',
        url: '/api/v1/tasks/task-1/fail',
        id: 'req-3',
        headers: { 'user-agent': 'vitest' },
        routeOptions: { url: '/api/v1/tasks/:id/fail' },
      },
      {
        elapsedTime: 14,
        statusCode: 200,
      },
    );

    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'debug',
        operation: 'api.post.tasks.:param.fail',
        status: 'completed',
      }),
    );
  });
});
