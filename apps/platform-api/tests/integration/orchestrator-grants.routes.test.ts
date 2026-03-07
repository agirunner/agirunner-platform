import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

describe('orchestrator grant routes', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminKey: string;
  let agentId: string;
  let pipelineId: string;
  const previousEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    db = await startTestDatabase();

    for (const key of [
      'NODE_ENV',
      'PORT',
      'DATABASE_URL',
      'JWT_SECRET',
      'WEBHOOK_ENCRYPTION_KEY',
      'JWT_EXPIRES_IN',
      'JWT_REFRESH_EXPIRES_IN',
      'LOG_LEVEL',
      'RATE_LIMIT_MAX_PER_MINUTE',
    ]) {
      previousEnv[key] = process.env[key];
    }

    process.env.NODE_ENV = 'test';
    process.env.PORT = '8096';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.JWT_EXPIRES_IN = '5m';
    process.env.JWT_REFRESH_EXPIRES_IN = '1h';
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '200';

    agentId = randomUUID();
    pipelineId = randomUUID();

    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'grant-agent',ARRAY['coordination'],'idle',30)`,
      [agentId, tenantId],
    );
    await db.pool.query(
      `INSERT INTO pipelines (id, tenant_id, name, state)
       VALUES ($1,$2,'grant-pipeline','active')`,
      [pipelineId, tenantId],
    );

    adminKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'admin',
        ownerType: 'user',
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).apiKey;

    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await stopTestDatabase(db);
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it('creates, lists, and revokes orchestrator grants', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrator-grants',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        agent_id: agentId,
        pipeline_id: pipelineId,
        permissions: ['create_subtasks'],
      },
    });

    expect(create.statusCode).toBe(201);
    expect(create.json().data).toMatchObject({
      agent_id: agentId,
      pipeline_id: pipelineId,
      permissions: ['create_subtasks'],
    });

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/orchestrator-grants?pipeline_id=${pipelineId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().data).toEqual([
      expect.objectContaining({
        agent_id: agentId,
        pipeline_id: pipelineId,
      }),
    ]);

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/v1/orchestrator-grants/${create.json().data.id as string}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().data).toEqual({
      id: create.json().data.id,
      revoked: true,
    });
  });
});
