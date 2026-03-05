import { createHmac, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

describe('S4 API contract closure', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminKey: string;
  let agentKey: string;
  let workerKey: string;
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
      'GIT_WEBHOOK_GITHUB_SECRET',
      'GIT_WEBHOOK_GITEA_SECRET',
      'GIT_WEBHOOK_GITLAB_SECRET',
    ]) {
      previousEnv[key] = process.env[key];
    }

    process.env.NODE_ENV = 'test';
    process.env.PORT = '8091';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.JWT_EXPIRES_IN = '5m';
    process.env.JWT_REFRESH_EXPIRES_IN = '1h';
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '200';
    process.env.GIT_WEBHOOK_GITHUB_SECRET = 'github-secret-s4';

    adminKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'admin',
        ownerType: 'user',
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).apiKey;

    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'s4-agent',ARRAY['ts'],'active',30)`,
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

    workerKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'worker',
        ownerType: 'worker',
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

  it('exposes Projects API with CRUD + memory patch and normalized success envelope meta', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'S4 Project',
        slug: 's4-project',
        description: 'S4 closure',
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().data.slug).toBe('s4-project');
    expect(created.json().meta.request_id).toBeTypeOf('string');
    expect(created.json().meta.timestamp).toBeTypeOf('string');

    const projectId = created.json().data.id as string;

    const patchedMemory = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/memory`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        key: 'handbook_version',
        value: 'v1.05-s4',
      },
    });

    expect(patchedMemory.statusCode).toBe(200);
    expect(patchedMemory.json().data.memory.handbook_version).toBe('v1.05-s4');

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/projects?page=1&per_page=10',
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().meta.page).toBe(1);
    expect(listed.json().meta.request_id).toBeTypeOf('string');

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data.deleted).toBe(true);
  });

  it('supports task create for agent/worker scopes and retry override_input + force', async () => {
    const workerCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${workerKey}` },
      payload: {
        title: 'worker allowed',
        type: 'code',
      },
    });
    expect(workerCreate.statusCode).toBe(201);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        title: 'agent allowed',
        type: 'code',
        input: { attempt: 1 },
      },
    });

    expect(created.statusCode).toBe(201);
    const taskId = created.json().data.id as string;

    await db.pool.query(`UPDATE tasks SET state = 'failed' WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      taskId,
    ]);

    const retried = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/retry`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        override_input: { attempt: 2, reason: 'manual' },
      },
    });

    expect(retried.statusCode).toBe(200);
    expect(retried.json().data.input).toEqual({ attempt: 2, reason: 'manual' });

    await db.pool.query(`UPDATE tasks SET state = 'cancelled' WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      taskId,
    ]);

    const blockedRetry = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/retry`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {},
    });
    expect(blockedRetry.statusCode).toBe(409);

    const forcedRetry = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/retry`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { force: true },
    });
    expect(forcedRetry.statusCode).toBe(200);
    expect(forcedRetry.json().data.state).toBe('ready');
  });

  it('adds pipeline delete endpoint for terminal pipelines', async () => {
    const template = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'delete-template',
        slug: `delete-template-${Date.now()}`,
        schema: { tasks: [{ id: 'a', title_template: 'A', type: 'code' }] },
      },
    });
    const templateId = template.json().data.id as string;

    const pipeline = await app.inject({
      method: 'POST',
      url: '/api/v1/pipelines',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        template_id: templateId,
        name: 'deletable-pipeline',
      },
    });

    const pipelineId = pipeline.json().data.id as string;
    await db.pool.query(`UPDATE pipelines SET state = 'completed' WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      pipelineId,
    ]);
    await db.pool.query(`UPDATE tasks SET state = 'completed' WHERE tenant_id = $1 AND pipeline_id = $2`, [
      tenantId,
      pipelineId,
    ]);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/pipelines/${pipelineId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data.deleted).toBe(true);
  });

  it('enforces auth refresh csrf + rotation + logout invalidation and returns expires_at', async () => {
    const token = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { api_key: adminKey },
    });
    expect(token.statusCode).toBe(200);
    expect(token.json().data.expires_at).toBeTypeOf('string');

    const cookies = Array.isArray(token.headers['set-cookie'])
      ? token.headers['set-cookie']
      : [token.headers['set-cookie'] as string];

    const refreshCookie = cookies.find((c) => c.startsWith('agentbaton_refresh_token='))!.split(';')[0];
    const csrfCookie = cookies.find((c) => c.startsWith('agentbaton_csrf_token='))!.split(';')[0];
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
    expect(refresh.json().data.expires_at).toBeTypeOf('string');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie: `${refreshCookie}; ${csrfCookie}`,
        'x-csrf-token': csrfToken,
      },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json().data.logged_out).toBe(true);

    const refreshAfterLogout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        cookie: `${refreshCookie}; ${csrfCookie}`,
        'x-csrf-token': csrfToken,
      },
    });
    expect(refreshAfterLogout.statusCode).toBe(401);
  });

  it('supports inbound git webhook receiver with signature verification on exact raw payload bytes', async () => {
    const taskId = randomUUID();
    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, state, input, context)
       VALUES ($1,$2,'webhook-target','code','ready','{}'::jsonb,'{}'::jsonb)`,
      [taskId, tenantId],
    );

    const rawPayload = JSON.stringify(
      {
        action: 'opened',
        pull_request: {
          title: `Implements task ${taskId}`,
          body: 'S4 webhook coverage',
        },
      },
      null,
      2,
    );
    const signature = createHmac('sha256', 'github-secret-s4').update(rawPayload).digest('hex');

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/git',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      payload: rawPayload,
    });

    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().data.mapped_task_id).toBe(taskId);

    const taskAfter = await db.pool.query('SELECT git_info FROM tasks WHERE id = $1', [taskId]);
    expect(taskAfter.rows[0].git_info.provider).toBe('github');

    const tamperedPayload = `${rawPayload}\n`;
    const tampered = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/git',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      payload: tamperedPayload,
    });

    expect(tampered.statusCode).toBe(401);

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/git',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': 'sha256=deadbeef',
      },
      payload: rawPayload,
    });

    expect(rejected.statusCode).toBe(401);
  });

  it('returns CYCLE_DETECTED when template dependency graph contains a cycle', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'cycle-template',
        slug: `cycle-template-${Date.now()}`,
        schema: {
          tasks: [
            { id: 'a', title_template: 'A', type: 'code', depends_on: ['b'] },
            { id: 'b', title_template: 'B', type: 'code', depends_on: ['a'] },
          ],
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('CYCLE_DETECTED');
    expect(response.json().meta.request_id).toBeTypeOf('string');
  });
});
