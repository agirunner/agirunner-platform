import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

describe('auth token flow', () => {
  let db: TestDatabase;
  let adminKey: string;
  let agentKey: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.NODE_ENV = 'test';
    process.env.PORT = '8081';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.JWT_EXPIRES_IN = '1s';
    process.env.JWT_REFRESH_EXPIRES_IN = '2s';
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '100';

    adminKey = (
      await createApiKey(db.pool, {
        tenantId: '00000000-0000-0000-0000-000000000001',
        scope: 'admin',
        ownerType: 'user',
        expiresAt: new Date(Date.now() + 86_400_000),
      })
    ).apiKey;

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

  it('exchanges valid API key for JWT and sets secure refresh cookie flags', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { api_key: adminKey },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.token).toBeTypeOf('string');
    expect(body.data.refresh_token).toBeUndefined();

    const cookieHeader = response.headers['set-cookie'] as string;
    expect(cookieHeader).toContain('agentbaton_refresh_token=');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('Secure');
    expect(cookieHeader).toContain('SameSite=Strict');
    expect(cookieHeader).toContain('Path=/api/v1/auth/refresh');
  });

  it('refreshes access token when short-lived token expires', async () => {
    const authResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { api_key: adminKey },
    });

    const expiredAccessToken = authResponse.json().data.token as string;
    const cookieHeader = authResponse.headers['set-cookie'] as string;
    const refreshCookie = cookieHeader.split(';')[0];

    await new Promise((resolve) => setTimeout(resolve, 1_200));

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: refreshCookie },
    });
    expect(refreshResponse.statusCode).toBe(200);

    const refreshedAccessToken = refreshResponse.json().data.token as string;
    expect(refreshedAccessToken).toBeTypeOf('string');
    expect(refreshedAccessToken).not.toBe(expiredAccessToken);
  });

  it('rejects refresh when refresh token session has expired', async () => {
    const authResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { api_key: adminKey },
    });

    const cookieHeader = authResponse.headers['set-cookie'] as string;
    const refreshCookie = cookieHeader.split(';')[0];

    await new Promise((resolve) => setTimeout(resolve, 2_200));

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: refreshCookie },
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

    const cookieHeader = response.headers['set-cookie'] as string;
    const refreshCookie = cookieHeader.split(';')[0];
    await db.pool.query('UPDATE api_keys SET is_revoked = true WHERE key_prefix = $1', [adminKey.slice(0, 12)]);

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: refreshCookie },
    });

    expect(refresh.statusCode).toBe(401);
  });
});
