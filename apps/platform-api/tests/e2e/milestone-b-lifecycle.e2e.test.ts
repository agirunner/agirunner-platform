import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

describe('milestone b lifecycle e2e', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminKey: string;
  let workerKey: string;
  let agentKey: string;
  let agentId: string;

  beforeAll(async () => {
    db = await startTestDatabase();

    process.env.NODE_ENV = 'test';
    process.env.PORT = '8089';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'z'.repeat(64);
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

    workerKey = (
      await createApiKey(db.pool, {
        tenantId: '00000000-0000-0000-0000-000000000001',
        scope: 'worker',
        ownerType: 'worker',
        expiresAt: new Date(Date.now() + 86_400_000),
      })
    ).apiKey;

    app = await buildApp();

    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/register',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { name: 'e2e-agent', capabilities: ['typescript', 'backend'] },
    });

    agentId = register.json().data.id as string;
    agentKey = register.json().data.api_key as string;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await stopTestDatabase(db);
  });

  it('runs full external-worker lifecycle flow', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${workerKey}` },
      payload: {
        title: 'Implement login endpoint',
        type: 'code',
        priority: 'high',
        capabilities_required: ['typescript', 'backend'],
      },
    });
    expect(create.statusCode).toBe(201);
    const taskId = create.json().data.id as string;

    const claim = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/claim',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { agent_id: agentId, capabilities: ['typescript', 'backend', 'testing'] },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().data.state).toBe('claimed');

    const start = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/start`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { agent_id: agentId },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().data.state).toBe('running');

    const context = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${taskId}/context`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(context.statusCode).toBe(200);

    const complete = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/complete`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { output: { summary: 'done' } },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().data.state).toBe('completed');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?state=completed',
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(list.statusCode).toBe(200);
    expect(Array.isArray(list.json().data)).toBe(true);
  });

  it('matches endpoint error matrix status classes', async () => {
    const missing = await app.inject({ method: 'POST', url: '/api/v1/tasks/claim', payload: {} });
    expect(missing.statusCode).toBe(401);

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { title: 'x', type: 'code' },
    });
    expect(allowed.statusCode).toBe(201);

    const notFound = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${randomUUID()}/start`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { agent_id: agentId },
    });
    expect(notFound.statusCode).toBe(404);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${workerKey}` },
      payload: { title: 'conflict-task', type: 'code', capabilities_required: ['typescript'] },
    });
    const taskId = created.json().data.id as string;

    const conflict = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/complete`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { output: { should: 'fail' } },
    });
    expect(conflict.statusCode).toBe(409);

    const unprocessable = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/claim',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { agent_id: 'not-uuid', capabilities: [] },
    });
    expect(unprocessable.statusCode).toBe(422);

    const approveForbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/approve`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(approveForbidden.statusCode).toBe(403);

    const retryNotFound = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${randomUUID()}/retry`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(retryNotFound.statusCode).toBe(404);

    const cancelCompleteConflict = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/cancel`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect([200, 409]).toContain(cancelCompleteConflict.statusCode);
  });
});
