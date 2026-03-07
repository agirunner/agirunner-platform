import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

describe('auth token flow', () => {
  let db: TestDatabase;
  let adminKey: string;
  let adminKeyPrefix: string;
  let agentKey: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.NODE_ENV = 'test';
    process.env.PORT = '8081';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.JWT_EXPIRES_IN = '1s';
    process.env.JWT_REFRESH_EXPIRES_IN = '30s'; // long enough to avoid timing flakiness from bcrypt overhead
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '100';
    process.env.DEFAULT_ADMIN_API_KEY = 'test';

    const adminKeyResult = await createApiKey(db.pool, {
      tenantId: '00000000-0000-0000-0000-000000000001',
      scope: 'admin',
      ownerType: 'user',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    adminKey = adminKeyResult.apiKey;
    adminKeyPrefix = adminKeyResult.keyPrefix;

    agentKey = (
      await createApiKey(db.pool, {
        tenantId: '00000000-0000-0000-0000-000000000001',
        scope: 'agent',
        ownerType: 'agent',
        expiresAt: new Date(Date.now() + 86_400_000),
      })
    ).apiKey;

    app = await buildApp();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await stopTestDatabase(db);
  });

  it('exchanges valid API key for JWT and applies secure cookies only for HTTPS', async () => {
    const httpResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { api_key: adminKey },
    });

    expect(httpResponse.statusCode).toBe(200);
    const body = httpResponse.json();
    expect(body.data.token).toBeTypeOf('string');
    expect(body.data.expires_at).toBeTypeOf('string');
    expect(body.data.refresh_expires_at).toBeTypeOf('string');
    expect(body.data.refresh_token).toBeUndefined();

    const httpCookies = Array.isArray(httpResponse.headers['set-cookie'])
      ? httpResponse.headers['set-cookie']
      : [httpResponse.headers['set-cookie'] as string];
    const httpRefreshCookie = httpCookies.find((c) => c.startsWith('agentbaton_refresh_token='))!;
    expect(httpRefreshCookie).toContain('agentbaton_refresh_token=');
    expect(httpRefreshCookie).toContain('HttpOnly');
    expect(httpRefreshCookie).not.toContain('Secure');
    expect(httpRefreshCookie).toContain('SameSite=Strict');
    expect(httpRefreshCookie).toContain('Path=/api/v1/auth/refresh');

    const httpAccessCookie = httpCookies.find((c) => c.startsWith('agentbaton_access_token='))!;
    expect(httpAccessCookie).toContain('HttpOnly');
    expect(httpAccessCookie).not.toContain('Secure');
    expect(httpAccessCookie).toContain('Path=/');

    const httpsResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      headers: { 'x-forwarded-proto': 'https' },
      payload: { api_key: adminKey },
    });

    expect(httpsResponse.statusCode).toBe(200);
    const httpsCookies = Array.isArray(httpsResponse.headers['set-cookie'])
      ? httpsResponse.headers['set-cookie']
      : [httpsResponse.headers['set-cookie'] as string];
    const httpsRefreshCookie = httpsCookies.find((c) => c.startsWith('agentbaton_refresh_token='))!;
    const httpsAccessCookie = httpsCookies.find((c) => c.startsWith('agentbaton_access_token='))!;
    expect(httpsRefreshCookie).toContain('Secure');
    expect(httpsAccessCookie).toContain('Secure');
  });

  it('accepts the configured bootstrap admin api key even when it is not in canonical format', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { api_key: 'test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.scope).toBe('admin');
  });

  it('allows JWT access token from /auth/token on protected API routes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { api_key: adminKey },
    });

    expect(response.statusCode).toBe(200);
    const token = response.json().data.token as string;

    const pipelines = await app.inject({
      method: 'GET',
      url: '/api/v1/pipelines?page=1&per_page=10',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(pipelines.statusCode).toBe(200);
  });

  it('rejects previously issued access token after key revocation', async () => {
    const revocableKeyResult = await createApiKey(db.pool, {
      tenantId: '00000000-0000-0000-0000-000000000001',
      scope: 'admin',
      ownerType: 'user',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const revocableKey = revocableKeyResult.apiKey;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { api_key: revocableKey },
    });

    expect(response.statusCode).toBe(200);
    const token = response.json().data.token as string;

    const beforeRevocation = await app.inject({
      method: 'GET',
      url: '/api/v1/pipelines?page=1&per_page=10',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(beforeRevocation.statusCode).toBe(200);

    await db.pool.query('UPDATE api_keys SET is_revoked = true WHERE key_prefix = $1', [revocableKeyResult.keyPrefix]);

    const afterRevocation = await app.inject({
      method: 'GET',
      url: '/api/v1/pipelines?page=1&per_page=10',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterRevocation.statusCode).toBe(401);
  });

  it('refreshes access token when short-lived token expires', async () => {
    const authResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { api_key: adminKey },
    });

    const expiredAccessToken = authResponse.json().data.token as string;
    const authCookies = Array.isArray(authResponse.headers['set-cookie'])
      ? authResponse.headers['set-cookie']
      : [authResponse.headers['set-cookie'] as string];
    const refreshCookie = authCookies.find((c) => c.startsWith('agentbaton_refresh_token='))!.split(';')[0];
    const csrfCookie = authCookies.find((c) => c.startsWith('agentbaton_csrf_token='))!.split(';')[0];
    const csrfToken = csrfCookie.split('=')[1];

    await new Promise((resolve) => setTimeout(resolve, 1_200));

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: `${refreshCookie}; ${csrfCookie}`,
        'x-csrf-token': csrfToken,
      },
    });
    expect(refreshResponse.statusCode).toBe(200);

    const refreshedAccessToken = refreshResponse.json().data.token as string;
    expect(refreshedAccessToken).toBeTypeOf('string');
    expect(refreshedAccessToken).not.toBe(expiredAccessToken);
  });

  it('rejects refresh when refresh token session has expired', async () => {
    // Craft a short-lived refresh token (1s TTL) directly, then wait for it to expire.
    // This avoids depending on the global JWT_REFRESH_EXPIRES_IN setting.
    const shortLivedRefreshToken = app.jwt.sign(
      {
        keyId: 'test-key-id',
        tenantId: '00000000-0000-0000-0000-000000000001',
        scope: 'admin',
        ownerType: 'user',
        ownerId: null,
        keyPrefix: 'ab_admin_xxx',
        tokenType: 'refresh',
      },
      { expiresIn: '1s' },
    );

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `agentbaton_refresh_token=${shortLivedRefreshToken}` },
    });

    expect(refresh.statusCode).toBe(401);
  });

  it('rejects invalid API key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { api_key: 'ab_admin_invalid_key_invalid_key' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects wrong scope for protected endpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/detail',
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('protects metrics endpoint with admin scope', async () => {
    const unauthenticated = await app.inject({ method: 'GET', url: '/metrics' });
    expect(unauthenticated.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(forbidden.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('binds refresh JWT to an active API key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { api_key: adminKey },
    });

    const bindCookies = Array.isArray(response.headers['set-cookie'])
      ? response.headers['set-cookie']
      : [response.headers['set-cookie'] as string];
    const refreshCookie = bindCookies.find((c) => c.startsWith('agentbaton_refresh_token='))!.split(';')[0];
    const csrfCookie = bindCookies.find((c) => c.startsWith('agentbaton_csrf_token='))!.split(';')[0];
    const csrfToken = csrfCookie.split('=')[1];
    await db.pool.query('UPDATE api_keys SET is_revoked = true WHERE key_prefix = $1', [adminKeyPrefix]);

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: `${refreshCookie}; ${csrfCookie}`,
        'x-csrf-token': csrfToken,
      },
    });

    expect(refresh.statusCode).toBe(401);
  });
});
