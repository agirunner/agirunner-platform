import { describe, expect, it, vi } from 'vitest';

import { logAuthEvent } from '../../../../src/logging/request/auth-log.js';

describe('logAuthEvent', () => {
  it('logsSuccessfulLoginWithInfoLevel', async () => {
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    await logAuthEvent(logService as never, {
      tenantId: 'tenant-1',
      type: 'login',
      method: 'password',
      actorType: 'user',
      actorId: 'user-1',
      actorName: 'Mark Johnson',
      payload: { email: 'mark@example.com', ip: '192.168.1.10' },
    });

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        source: 'platform',
        category: 'auth',
        level: 'info',
        operation: 'auth.login',
        status: 'completed',
        actorType: 'user',
        actorId: 'user-1',
        actorName: 'Mark Johnson',
        payload: expect.objectContaining({
          auth_method: 'password',
          email: 'mark@example.com',
          ip: '192.168.1.10',
        }),
      }),
    );
  });

  it('logsFailedLoginWithWarnLevel', async () => {
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    await logAuthEvent(logService as never, {
      tenantId: 'tenant-1',
      type: 'login_failed',
      method: 'password',
      actorType: 'user',
      actorId: 'unknown',
      actorName: 'Unknown',
      payload: { failure_reason: 'invalid_credentials' },
    });

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        operation: 'auth.login_failed',
        status: 'failed',
      }),
    );
  });

  it('logsSsoCallbackAsCompletedEvent', async () => {
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    await logAuthEvent(logService as never, {
      tenantId: 'tenant-1',
      type: 'sso_callback',
      method: 'sso_google',
      actorType: 'user',
      actorId: 'user-2',
      actorName: 'Jane Doe',
    });

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        operation: 'auth.sso_callback',
        status: 'completed',
      }),
    );
  });

  it('logsTokenRefreshFailureAsWarning', async () => {
    const logInsert = vi.fn().mockResolvedValue(undefined);
    const logService = { insert: logInsert };

    await logAuthEvent(logService as never, {
      tenantId: 'tenant-1',
      type: 'token_refresh_failed',
      method: 'jwt',
      actorType: 'user',
      actorId: 'user-3',
      actorName: 'Bob Smith',
      payload: { failure_reason: 'expired_token' },
    });

    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        status: 'failed',
        operation: 'auth.token_refresh_failed',
      }),
    );
  });
});
