import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

describe('platform foundation e2e', () => {
  let db: TestDatabase;
  let adminKey: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    db = await startTestDatabase();

    process.env.NODE_ENV = 'test';
    process.env.PORT = '8082';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'y'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.LOG_LEVEL = 'error';

    adminKey = (
      await createApiKey(db.pool, {
        tenantId: '00000000-0000-0000-0000-000000000001',
        scope: 'admin',
        ownerType: 'user',
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

  it('returns healthy status payload from /health endpoint', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('supports token exchange and refresh', async () => {
    const exchange = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { api_key: adminKey },
    });

    expect(exchange.statusCode).toBe(200);
    const setCookies = Array.isArray(exchange.headers['set-cookie'])
      ? exchange.headers['set-cookie']
      : [exchange.headers['set-cookie'] as string];
    const refreshCookie = setCookies.find((c) => c.startsWith('agirunner_refresh_token='))!.split(';')[0];
    const csrfCookie = setCookies.find((c) => c.startsWith('agirunner_csrf_token='))!.split(';')[0];
    const csrfToken = csrfCookie.split('=')[1];

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: `${refreshCookie}; ${csrfCookie}`,
        'x-csrf-token': csrfToken,
      },
    });

    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().data.token).toBeTypeOf('string');
  });

  it('exposes prometheus metrics for authenticated admin requests', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('# HELP http_requests_total');
  });
});
