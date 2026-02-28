import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

describe('rate limiting', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.NODE_ENV = 'test';
    process.env.PORT = '8084';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'r'.repeat(64);
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '2';

    app = await buildApp();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await stopTestDatabase(db);
  });

  it('enforces the configured request cap', async () => {
    const first = await app.inject({ method: 'GET', url: '/health' });
    const second = await app.inject({ method: 'GET', url: '/health' });
    const third = await app.inject({ method: 'GET', url: '/health' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
  });
});
