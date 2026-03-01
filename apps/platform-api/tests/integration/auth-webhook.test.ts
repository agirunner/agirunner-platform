import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { EventService } from '../../src/services/event-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { WebhookService } from '../../src/services/webhook-service.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';
const config = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  TASK_DEFAULT_AUTO_RETRY: false,
  TASK_DEFAULT_MAX_RETRIES: 0,
};

describe('auth and webhook coverage', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminKey: string;
  let workerKey: string;
  let agentIdentity: { id: string; tenantId: string; scope: 'agent'; ownerType: 'agent'; ownerId: string; keyPrefix: string };
  const previousEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    db = await startTestDatabase();

    for (const key of ['NODE_ENV', 'PORT', 'DATABASE_URL', 'JWT_SECRET', 'WEBHOOK_ENCRYPTION_KEY', 'JWT_EXPIRES_IN', 'JWT_REFRESH_EXPIRES_IN', 'LOG_LEVEL', 'RATE_LIMIT_MAX_PER_MINUTE']) {
      previousEnv[key] = process.env[key];
    }

    process.env.NODE_ENV = 'test';
    process.env.PORT = '8084';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.JWT_EXPIRES_IN = '5m';
    process.env.JWT_REFRESH_EXPIRES_IN = '1h';
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '200';

    adminKey = (await createApiKey(db.pool, { tenantId, scope: 'admin', ownerType: 'user', expiresAt: new Date(Date.now() + 600_000) })).apiKey;
    workerKey = (await createApiKey(db.pool, { tenantId, scope: 'worker', ownerType: 'worker', expiresAt: new Date(Date.now() + 600_000) })).apiKey;

    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'auth-agent',ARRAY['ts'],'active',30)`,
      [agentId, tenantId],
    );

    const agentKey = await createApiKey(db.pool, {
      tenantId,
      scope: 'agent',
      ownerType: 'agent',
      ownerId: agentId,
      expiresAt: new Date(Date.now() + 600_000),
    });

    agentIdentity = { id: 'agent', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentId, keyPrefix: agentKey.keyPrefix };

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

  it('covers FR-044/FR-045/FR-046/FR-046a/FR-426a bearer auth, scope checks and jwt session endpoints', async () => {
    const tokenRes = await app.inject({ method: 'POST', url: '/api/v1/auth/token', payload: { api_key: adminKey } });
    expect(tokenRes.statusCode).toBe(200);
    expect(tokenRes.json().data.token).toBeTypeOf('string');

    // Both access and refresh tokens set as httpOnly cookies
    const cookies = Array.isArray(tokenRes.headers['set-cookie'])
      ? tokenRes.headers['set-cookie']
      : [tokenRes.headers['set-cookie'] as string];
    const accessCookie = cookies.find((c) => c.startsWith('agentbaton_access_token='));
    const refreshCookie = cookies.find((c) => c.startsWith('agentbaton_refresh_token='));
    expect(accessCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('HttpOnly');

    const forbidden = await app.inject({ method: 'GET', url: '/api/v1/workers', headers: { authorization: `Bearer ${workerKey}` } });
    expect(forbidden.statusCode).toBe(403);

    const refreshCookieValue = refreshCookie!.split(';')[0];
    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: refreshCookieValue },
    });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().data.token).toBeTypeOf('string');
  });

  it('GET /api/v1/auth/me returns identity from httpOnly access cookie', async () => {
    const tokenRes = await app.inject({ method: 'POST', url: '/api/v1/auth/token', payload: { api_key: adminKey } });
    const cookies = Array.isArray(tokenRes.headers['set-cookie'])
      ? tokenRes.headers['set-cookie']
      : [tokenRes.headers['set-cookie'] as string];
    const accessCookie = cookies.find((c) => c.startsWith('agentbaton_access_token='))!.split(';')[0];

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: accessCookie },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().data.authenticated).toBe(true);
    expect(meRes.json().data.scope).toBe('admin');
    expect(meRes.json().data.tenant_id).toBe(tenantId);
  });

  it('GET /api/v1/auth/me returns 401 without credentials', async () => {
    const meRes = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(meRes.statusCode).toBe(401);
  });

  it('covers FR-047/FR-048 periodic timeout checks and auto-retry on timeout', async () => {
    const taskService = new TaskService(db.pool, new EventService(db.pool), config);

    const timedOutTask = await taskService.createTask(
      { id: 'worker', tenantId, scope: 'worker', ownerType: 'worker', ownerId: null, keyPrefix: 'w1' },
      {
        title: 'timed-out',
        type: 'code',
        auto_retry: true,
        max_retries: 1,
        timeout_minutes: 1,
      },
    );

    await db.pool.query(
      `UPDATE tasks
       SET state = 'claimed', assigned_agent_id = $3, claimed_at = now() - interval '10 minutes'
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, timedOutTask.id, agentIdentity.ownerId],
    );
    await db.pool.query(`UPDATE agents SET current_task_id = $3, status = 'busy' WHERE tenant_id = $1 AND id = $2`, [tenantId, agentIdentity.ownerId, timedOutTask.id]);

    await taskService.failTimedOutTasks(new Date());
    const taskAfter = (await taskService.getTask(tenantId, timedOutTask.id as string)) as Record<string, unknown>;

    expect(taskAfter.state).toBe('ready');
    expect(taskAfter.retry_count).toBe(1);
  });

  it('covers FR-027/FR-210/FR-211 webhook CRUD endpoints and list contract', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { url: 'https://example.com/hook', event_types: ['task.*'] },
    });
    expect(created.statusCode).toBe(201);

    const webhookId = created.json().data.id as string;

    const list = await app.inject({ method: 'GET', url: '/api/v1/webhooks', headers: { authorization: `Bearer ${adminKey}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((hook: { id: string }) => hook.id === webhookId)).toBe(true);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/webhooks/${webhookId}`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { event_types: ['task.state_changed'], is_active: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.event_types).toEqual(['task.state_changed']);
  });

  it('encrypts webhook secrets at rest while returning plaintext once on create', async () => {
    const providedSecret = 'super-secret-webhook-token';
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { url: 'https://example.com/secure-hook', event_types: ['task.*'], secret: providedSecret },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().data.secret).toBe(providedSecret);

    const webhookId = created.json().data.id as string;
    const stored = await db.pool.query('SELECT secret FROM webhooks WHERE id = $1', [webhookId]);

    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0].secret).not.toBe(providedSecret);
    expect(stored.rows[0].secret.startsWith('enc:v1:')).toBe(true);
  });

  it('migrates existing plaintext webhook secrets to encrypted storage', async () => {
    const webhookId = randomUUID();
    await db.pool.query(
      `INSERT INTO webhooks (id, tenant_id, url, secret, event_types, is_active)
       VALUES ($1,$2,$3,$4,$5,true)`,
      [webhookId, tenantId, 'https://example.com/legacy-hook', 'legacy-plaintext-secret', ['task.created']],
    );

    const webhookService = new WebhookService(db.pool, app.config);
    const migratedCount = await webhookService.migratePlaintextSecrets();
    expect(migratedCount).toBeGreaterThan(0);

    const migrated = await db.pool.query('SELECT secret FROM webhooks WHERE id = $1', [webhookId]);
    expect(migrated.rows[0].secret).not.toBe('legacy-plaintext-secret');
    expect(migrated.rows[0].secret.startsWith('enc:v1:')).toBe(true);
  });

  it('covers FR-028/FR-029/FR-054/FR-212 webhook delivery mapping emits persisted deliveries', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('ok', { status: 200 }));
    const webhookService = new WebhookService(db.pool, {
      ...app.config,
      WEBHOOK_MAX_ATTEMPTS: 1,
      WEBHOOK_RETRY_BASE_DELAY_MS: 1,
    }, fetchMock);

    const created = await webhookService.registerWebhook(
      { id: 'admin', tenantId, scope: 'admin', ownerType: 'user', ownerId: null, keyPrefix: 'admin' },
      { url: 'https://example.com/git-events', event_types: ['task.state_changed'] },
    );

    const eventInsert = await db.pool.query(
      `INSERT INTO events (tenant_id, type, entity_type, entity_id, actor_type, actor_id, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING id, created_at`,
      [tenantId, 'task.state_changed', 'task', randomUUID(), 'system', 'sys', JSON.stringify({ branch: 'feature/task-123', message: 'AB-123' })],
    );

    await webhookService.deliverEvent({
      id: eventInsert.rows[0].id,
      tenant_id: tenantId,
      type: 'task.state_changed',
      entity_type: 'task',
      entity_id: randomUUID(),
      actor_type: 'system',
      actor_id: 'sys',
      data: { branch: 'feature/task-123', message: 'AB-123' },
      created_at: eventInsert.rows[0].created_at,
    });

    expect(fetchMock).toHaveBeenCalled();

    const deliveries = await db.pool.query(
      `SELECT webhook_id, event_id, status, attempts
       FROM webhook_deliveries
       WHERE tenant_id = $1 AND webhook_id = $2 AND event_id = $3`,
      [tenantId, created.id, eventInsert.rows[0].id],
    );

    expect(deliveries.rowCount).toBeGreaterThan(0);
    expect(deliveries.rows.every((row) => row.webhook_id === created.id)).toBe(true);
    expect(deliveries.rows.some((row) => row.status === 'delivered' && row.attempts >= 1)).toBe(true);
  });
});
