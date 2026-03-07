import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

describe('a2a routes', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let agentKey: string;
  let agentId: string;
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
    process.env.PORT = '8103';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.JWT_EXPIRES_IN = '5m';
    process.env.JWT_REFRESH_EXPIRES_IN = '1h';
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '200';

    agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'a2a-agent',ARRAY['a2a'],'idle',30)`,
      [agentId, tenantId],
    );
    agentKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'agent',
        ownerType: 'agent',
        ownerId: agentId,
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

  it('exposes an unauthenticated A2A agent card', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/.well-known/agent.json',
      headers: { host: 'platform.local' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        protocol: 'a2a',
        endpoints: expect.objectContaining({
          submit_task: 'http://platform.local/api/v1/a2a/tasks',
        }),
      }),
    );
  });

  it('creates and queries tasks through the A2A facade while preserving the normal lifecycle', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/a2a/tasks',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        task: {
          id: 'ext-123',
          title: 'A2A review task',
          description: 'Review imported via A2A',
          type: 'review',
          capabilities: ['a2a'],
          input: { objective: 'validate facade' },
          metadata: { source: 'external-a2a-client' },
        },
      },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().data.status).toBe('submitted');
    const taskId = createResponse.json().data.id as string;

    const createdTask = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${taskId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(createdTask.statusCode).toBe(200);
    expect(createdTask.json().data.metadata.protocol_ingress).toEqual({
      protocol: 'a2a',
      external_task_id: 'ext-123',
    });

    const claimResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/claim',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        agent_id: agentId,
        capabilities: ['a2a'],
      },
    });
    expect(claimResponse.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/start`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { agent_id: agentId },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/complete`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { output: { ok: true }, agent_id: agentId },
    });

    const statusResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/a2a/tasks/${taskId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json().data).toEqual(
      expect.objectContaining({
        id: taskId,
        status: 'completed',
        result: { ok: true },
      }),
    );
  });
});
