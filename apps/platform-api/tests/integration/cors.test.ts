import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

describe('CORS preflight', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.NODE_ENV = 'test';
    process.env.PORT = '8089';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'c'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.LOG_LEVEL = 'error';
    process.env.CORS_ORIGIN = 'http://localhost:5173';
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await stopTestDatabase(db);
  });

  it('returns configured CORS headers for OPTIONS preflight', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/token',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
});
