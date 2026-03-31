import { createHash } from 'node:crypto';

import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  parseBearerToken: vi.fn((value: string) => value.replace(/^Bearer\s+/u, '')),
  verifyApiKey: vi.fn(),
  verifyJwtApiKeyIdentity: vi.fn(),
}));

const jwtMocks = vi.hoisted(() => ({
  issueAccessToken: vi.fn(),
  issueRefreshToken: vi.fn(),
  verifyJwt: vi.fn(),
}));

const loggingMocks = vi.hoisted(() => ({
  logAuthEvent: vi.fn(),
}));

vi.mock('../../../../../src/auth/api-key.js', () => authMocks);
vi.mock('../../../../../src/auth/jwt.js', () => jwtMocks);
vi.mock('../../../../../src/logging/request/auth-log.js', () => loggingMocks);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function createToken(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `${header}.${payload}.signature`;
}

function readSetCookieHeaders(headers: Record<string, string | string[] | undefined>): string[] {
  const setCookie = headers['set-cookie'];
  if (!setCookie) {
    return [];
  }
  return Array.isArray(setCookie) ? setCookie : [setCookie];
}

describe('auth routes persistent sessions', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.verifyApiKey.mockResolvedValue({
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'ar_admin_test',
    });
    authMocks.verifyJwtApiKeyIdentity.mockResolvedValue({
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'ar_admin_test',
    });
    jwtMocks.issueAccessToken.mockResolvedValue(createToken(1_900_000_000));
    jwtMocks.issueRefreshToken.mockResolvedValue(createToken(1_900_086_400));
    jwtMocks.verifyJwt.mockResolvedValue({
      keyId: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'ar_admin_test',
      tokenType: 'refresh',
      tokenId: 'refresh-token-1',
      persistentSession: true,
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  async function buildApp() {
    const { authRoutes } = await import('../../../../../src/api/routes/auth/auth.routes.js');

    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const clientQuery = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT api_key_id')) {
        return {
          rowCount: 1,
          rows: [
            {
              api_key_id: 'key-1',
              csrf_token_hash: sha256('csrf-token'),
              revoked_at: null,
              expires_at: new Date('2030-03-20T00:00:00.000Z'),
            },
          ],
        };
      }

      return { rowCount: 1, rows: [] };
    });

    app = fastify();
    await app.register(fastifyCookie);
    app.decorate('config', {
      JWT_EXPIRES_IN: '12h',
      JWT_REFRESH_EXPIRES_IN: '30d',
    } as never);
    app.decorate('pgPool', {
      query,
      connect: vi.fn().mockResolvedValue({
        query: clientQuery,
        release: vi.fn(),
      }),
    });
    app.decorate('logService', {});

    await app.register(authRoutes);

    return { query };
  }

  it('defaults login requests to persistent cookies when no explicit preference is provided', async () => {
    await buildApp();

    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        api_key: 'ar_admin_test_key',
      },
    });

    expect(response.statusCode).toBe(200);
    const setCookie = readSetCookieHeaders(response.headers);
    expect(setCookie.find((value) => value.startsWith('agirunner_access_token='))).toContain('Expires=');
    expect(setCookie.find((value) => value.startsWith('agirunner_refresh_token='))).toContain('Expires=');
    expect(setCookie.find((value) => value.startsWith('agirunner_csrf_token='))).toContain('Expires=');
  });

  it('accepts camelCase login payloads for interactive clients', async () => {
    await buildApp();

    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        apiKey: 'ar_admin_test_key',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(authMocks.verifyApiKey).toHaveBeenCalledWith(
      expect.anything(),
      'ar_admin_test_key',
    );
  });

  it('keeps login cookies session-scoped when persistent_session is false', async () => {
    await buildApp();

    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        api_key: 'ar_admin_test_key',
        persistent_session: false,
      },
    });

    expect(response.statusCode).toBe(200);
    const setCookie = readSetCookieHeaders(response.headers);
    expect(setCookie.find((value) => value.startsWith('agirunner_access_token='))).not.toContain('Expires=');
    expect(setCookie.find((value) => value.startsWith('agirunner_refresh_token='))).not.toContain('Expires=');
    expect(setCookie.find((value) => value.startsWith('agirunner_csrf_token='))).not.toContain('Expires=');
  });

  it.each([
    { persistentSession: true, expectsExpiry: true },
    { persistentSession: false, expectsExpiry: false },
  ])('preserves persistence mode during refresh rotation (%o)', async ({ persistentSession, expectsExpiry }) => {
    await buildApp();
    jwtMocks.verifyJwt.mockResolvedValue({
      keyId: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'ar_admin_test',
      tokenType: 'refresh',
      tokenId: 'refresh-token-1',
      persistentSession,
    });

    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: {
        agirunner_refresh_token: 'refresh-cookie',
        agirunner_csrf_token: 'csrf-token',
      },
      headers: {
        'x-csrf-token': 'csrf-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const setCookie = readSetCookieHeaders(response.headers);
    const accessCookie = setCookie.find((value) => value.startsWith('agirunner_access_token='));
    const refreshCookie = setCookie.find((value) => value.startsWith('agirunner_refresh_token='));
    const csrfCookie = setCookie.find((value) => value.startsWith('agirunner_csrf_token='));

    if (expectsExpiry) {
      expect(accessCookie).toContain('Expires=');
      expect(refreshCookie).toContain('Expires=');
      expect(csrfCookie).toContain('Expires=');
      return;
    }

    expect(accessCookie).not.toContain('Expires=');
    expect(refreshCookie).not.toContain('Expires=');
    expect(csrfCookie).not.toContain('Expires=');
  });
});
