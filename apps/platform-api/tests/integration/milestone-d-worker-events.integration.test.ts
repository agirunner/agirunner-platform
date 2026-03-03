import http from 'node:http';
import { randomUUID } from 'node:crypto';

import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { createWebhookSignature } from '../../src/services/worker-service.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForMessage(ws: WebSocket, predicate: (payload: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: unknown) => {
      let payload: Record<string, unknown>;
      try {
        const rawText = typeof raw === 'string' ? raw : String(raw);
        payload = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        return;
      }

      if (!predicate(payload)) {
        return;
      }

      cleanup();
      resolve(payload);
    };

    const onError = (error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const onClose = () => {
      cleanup();
      reject(new Error('websocket closed while waiting for message'));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout waiting for websocket message'));
    }, 15_000);

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
      ws.off('close', onClose);
    };

    ws.on('message', onMessage);
    ws.on('error', onError);
    ws.on('close', onClose);
  });
}

describe('milestone d worker/events integration', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let baseUrl: string;
  let adminKey: string;
  let workerBootstrapKey: string;
  let tenantTwoAdminKey: string;
  let tenantTwoWorkerKey: string;

  beforeAll(async () => {
    db = await startTestDatabase();

    process.env.NODE_ENV = 'test';
    process.env.PORT = '8092';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'w'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.LOG_LEVEL = 'error';
    process.env.WORKER_OFFLINE_GRACE_PERIOD_MS = '10000';

    adminKey = (
      await createApiKey(db.pool, {
        tenantId: '00000000-0000-0000-0000-000000000001',
        scope: 'admin',
        ownerType: 'user',
        expiresAt: new Date(Date.now() + 86_400_000),
      })
    ).apiKey;

    workerBootstrapKey = (
      await createApiKey(db.pool, {
        tenantId: '00000000-0000-0000-0000-000000000001',
        scope: 'worker',
        ownerType: 'bootstrap',
        expiresAt: new Date(Date.now() + 86_400_000),
      })
    ).apiKey;

    await db.pool.query(
      `INSERT INTO tenants (id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      ['00000000-0000-0000-0000-000000000002', 'Tenant Two', 'tenant-two'],
    );

    tenantTwoAdminKey = (
      await createApiKey(db.pool, {
        tenantId: '00000000-0000-0000-0000-000000000002',
        scope: 'admin',
        ownerType: 'user',
        expiresAt: new Date(Date.now() + 86_400_000),
      })
    ).apiKey;

    tenantTwoWorkerKey = (
      await createApiKey(db.pool, {
        tenantId: '00000000-0000-0000-0000-000000000002',
        scope: 'worker',
        ownerType: 'bootstrap',
        expiresAt: new Date(Date.now() + 86_400_000),
      })
    ).apiKey;

    app = await buildApp();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address.replace('[::1]', '127.0.0.1');
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await stopTestDatabase(db);
  }, 180_000);

  it('supports websocket dispatch flow and ack', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/v1/workers/register',
      headers: { authorization: `Bearer ${workerBootstrapKey}` },
      payload: {
        name: 'ws-worker',
        capabilities: ['typescript', 'testing'],
        agents: [{ name: 'ws-agent', capabilities: ['typescript', 'testing'] }],
      },
    });
    expect(registration.statusCode).toBe(201);

    const workerId = registration.json().data.worker_id as string;
    const workerApiKey = registration.json().data.worker_api_key as string;
    const agentId = registration.json().data.agents[0].id as string;

    const websocketPath = registration.json().data.websocket_url as string;
    const ws = new WebSocket(baseUrl.replace('http', 'ws') + websocketPath, {
      headers: { authorization: `Bearer ${workerApiKey}` },
    });
    await waitForMessage(ws, (msg) => msg.type === 'connection.ready');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${workerApiKey}` },
      payload: {
        title: 'dispatch-me',
        type: 'code',
        capabilities_required: ['typescript'],
      },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().data.id as string;

    const assignment = await waitForMessage(
      ws,
      (msg) => msg.type === 'task.assigned' && (msg.task as { id?: string } | undefined)?.id === taskId,
    );
    expect((assignment.task as { id: string }).id).toBe(taskId);

    ws.send(JSON.stringify({ type: 'task.assignment_ack', task_id: taskId, agent_id: agentId }));
    await wait(200);

    const task = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${taskId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(task.statusCode).toBe(200);
    expect(task.json().data.state).toBe('claimed');
    expect(task.json().data.assigned_worker_id).toBe(workerId);
    ws.close();
  });

  it('streams events over SSE and applies worker timeout recovery with grace period', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/v1/workers/register',
      headers: { authorization: `Bearer ${workerBootstrapKey}` },
      payload: { name: 'hb-worker', capabilities: ['go'] },
    });
    const workerId = registration.json().data.worker_id as string;

    const streamResponse = await fetch(`${baseUrl}/api/v1/events?event_type=worker.signaled`, {
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(streamResponse.status).toBe(200);

    await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerId}/signal`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { type: 'drain' },
    });

    const reader = streamResponse.body!.getReader();
    let aggregated = '';
    for (let i = 0; i < 10; i += 1) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      aggregated += new TextDecoder().decode(chunk.value);
      if (aggregated.includes('worker.signaled')) {
        break;
      }
    }
    expect(aggregated).toContain('worker.signaled');
    await reader.cancel();

    const staleTaskId = randomUUID();
    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, state, assigned_worker_id, claimed_at)
       VALUES ($1,$2,'stale','code','claimed',$3,now() - INTERVAL '10 minutes')`,
      [staleTaskId, '00000000-0000-0000-0000-000000000001', workerId],
    );
    const now = Date.now();
    const firstCheck = new Date(now);
    const lastHeartbeat = new Date(now - 61_000);

    await db.pool.query(
      `UPDATE workers
       SET status = 'online',
           last_heartbeat_at = $3,
           heartbeat_interval_seconds = 30
       WHERE tenant_id = $1 AND id = $2`,
      ['00000000-0000-0000-0000-000000000001', workerId, lastHeartbeat],
    );

    await app.workerService.enforceHeartbeatTimeouts(firstCheck);

    const [workerAfterOffline, taskBeforeGrace] = await Promise.all([
      db.pool.query('SELECT status FROM workers WHERE id = $1', [workerId]),
      db.pool.query('SELECT state, assigned_worker_id FROM tasks WHERE id = $1', [staleTaskId]),
    ]);

    expect(workerAfterOffline.rows[0].status).toBe('disconnected');
    expect(taskBeforeGrace.rows[0].state).toBe('claimed');
    expect(taskBeforeGrace.rows[0].assigned_worker_id).toBe(workerId);

    await app.workerService.enforceHeartbeatTimeouts(new Date(firstCheck.getTime() + 11_000));

    const taskAfterGrace = await db.pool.query('SELECT state, assigned_worker_id FROM tasks WHERE id = $1', [staleTaskId]);
    expect(taskAfterGrace.rows[0].state).toBe('ready');
    expect(taskAfterGrace.rows[0].assigned_worker_id).toBeNull();
  });

  it('accepts busy heartbeat when a disconnected worker reconnects', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/v1/workers/register',
      headers: { authorization: `Bearer ${workerBootstrapKey}` },
      payload: { name: 'reconnect-worker', capabilities: ['go'] },
    });
    expect(registration.statusCode).toBe(201);

    const workerId = registration.json().data.worker_id as string;
    const workerApiKey = registration.json().data.worker_api_key as string;
    const staleTaskId = randomUUID();

    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, state, assigned_worker_id, claimed_at)
       VALUES ($1,$2,'reconnect-stale','code','claimed',$3,now() - INTERVAL '10 minutes')`,
      [staleTaskId, '00000000-0000-0000-0000-000000000001', workerId],
    );

    await db.pool.query(
      `UPDATE workers
       SET status = 'disconnected',
           current_task_id = $3,
           heartbeat_interval_seconds = 30,
           last_heartbeat_at = now() - INTERVAL '61 seconds'
       WHERE tenant_id = $1 AND id = $2`,
      ['00000000-0000-0000-0000-000000000001', workerId, staleTaskId],
    );

    const reconnectHeartbeat = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerId}/heartbeat`,
      headers: { authorization: `Bearer ${workerApiKey}` },
      payload: {
        status: 'busy',
        current_task_id: staleTaskId,
      },
    });

    expect(reconnectHeartbeat.statusCode).toBe(200);

    const workerAfterReconnect = await db.pool.query(
      'SELECT status, current_task_id, last_heartbeat_at FROM workers WHERE tenant_id = $1 AND id = $2',
      ['00000000-0000-0000-0000-000000000001', workerId],
    );

    expect(workerAfterReconnect.rows[0].status).toBe('busy');
    expect(workerAfterReconnect.rows[0].current_task_id).toBe(staleTaskId);
    expect(workerAfterReconnect.rows[0].last_heartbeat_at).toBeTruthy();
  });

  it('deletes workers referenced by task assignments without FK violations', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/v1/workers/register',
      headers: { authorization: `Bearer ${workerBootstrapKey}` },
      payload: { name: 'delete-worker', capabilities: ['typescript'] },
    });
    expect(registration.statusCode).toBe(201);

    const workerId = registration.json().data.worker_id as string;
    const taskId = randomUUID();

    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, state, assigned_worker_id, claimed_at)
       VALUES ($1,$2,'delete-worker-task','code','claimed',$3,now())`,
      [taskId, '00000000-0000-0000-0000-000000000001', workerId],
    );

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workers/${workerId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(deleted.statusCode).toBe(204);

    const [worker, task] = await Promise.all([
      db.pool.query('SELECT id FROM workers WHERE tenant_id = $1 AND id = $2', [
        '00000000-0000-0000-0000-000000000001',
        workerId,
      ]),
      db.pool.query('SELECT state, assigned_worker_id FROM tasks WHERE tenant_id = $1 AND id = $2', [
        '00000000-0000-0000-0000-000000000001',
        taskId,
      ]),
    ]);

    expect(worker.rowCount).toBe(0);
    expect(task.rowCount).toBe(1);
    expect(task.rows[0].state).toBe('claimed');
    expect(task.rows[0].assigned_worker_id).toBeNull();
  });

  it('delivers webhooks with hmac signature', async () => {
    const received: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
    const webhookServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.statusCode = 200;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => webhookServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = webhookServer.address() as { port: number };

    const hook = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        url: `http://127.0.0.1:${addr.port}/hook`,
        event_types: ['task.created'],
      },
    });
    expect(hook.statusCode).toBe(201);
    const secret = hook.json().data.secret as string;

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${workerBootstrapKey}` },
      payload: {
        title: 'webhook-task',
        type: 'code',
      },
    });
    expect(create.statusCode).toBe(201);

    for (let i = 0; i < 20 && received.length === 0; i += 1) {
      await wait(100);
    }

    expect(received.length).toBeGreaterThan(0);
    const first = received[0];
    const signature = first.headers['x-agentbaton-signature'] as string;
    expect(signature).toBe(createWebhookSignature(secret, first.body));

    webhookServer.close();
  });

  it('updates webhook configuration through PATCH endpoint', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        url: 'https://example.com/initial',
        event_types: ['task.created'],
      },
    });

    expect(created.statusCode).toBe(201);
    const webhookId = created.json().data.id as string;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/webhooks/${webhookId}`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        url: 'https://example.com/updated',
        event_types: ['task.*'],
        is_active: false,
      },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.url).toBe('https://example.com/updated');
    expect(updated.json().data.event_types).toEqual(['task.*']);
    expect(updated.json().data.is_active).toBe(false);
  });

  it('delivers webhooks per tenant without cross-tenant leakage', async () => {
    await db.pool.query('DELETE FROM webhook_deliveries WHERE tenant_id = ANY($1::uuid[])', [
      ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
    ]);
    await db.pool.query('DELETE FROM webhooks WHERE tenant_id = ANY($1::uuid[])', [
      ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
    ]);

    const tenantOneEvents: string[] = [];
    const tenantTwoEvents: string[] = [];

    const tenantOneServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        tenantOneEvents.push(body);
        res.statusCode = 200;
        res.end('ok');
      });
    });

    const tenantTwoServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        tenantTwoEvents.push(body);
        res.statusCode = 200;
        res.end('ok');
      });
    });

    await Promise.all([
      new Promise<void>((resolve) => tenantOneServer.listen(0, '127.0.0.1', () => resolve())),
      new Promise<void>((resolve) => tenantTwoServer.listen(0, '127.0.0.1', () => resolve())),
    ]);

    const tenantOnePort = (tenantOneServer.address() as { port: number }).port;
    const tenantTwoPort = (tenantTwoServer.address() as { port: number }).port;

    const [tenantOneHook, tenantTwoHook] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/webhooks',
        headers: { authorization: `Bearer ${adminKey}` },
        payload: { url: `http://127.0.0.1:${tenantOnePort}/tenant-1`, event_types: ['task.created'] },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/webhooks',
        headers: { authorization: `Bearer ${tenantTwoAdminKey}` },
        payload: { url: `http://127.0.0.1:${tenantTwoPort}/tenant-2`, event_types: ['task.created'] },
      }),
    ]);

    expect(tenantOneHook.statusCode).toBe(201);
    expect(tenantTwoHook.statusCode).toBe(201);

    const [tenantOneTask, tenantTwoTask] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { authorization: `Bearer ${workerBootstrapKey}` },
        payload: { title: 'tenant-1-task', type: 'code' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { authorization: `Bearer ${tenantTwoWorkerKey}` },
        payload: { title: 'tenant-2-task', type: 'code' },
      }),
    ]);

    expect(tenantOneTask.statusCode).toBe(201);
    expect(tenantTwoTask.statusCode).toBe(201);

    for (let i = 0; i < 30 && (tenantOneEvents.length === 0 || tenantTwoEvents.length === 0); i += 1) {
      await wait(100);
    }

    expect(tenantOneEvents.length).toBeGreaterThan(0);
    expect(tenantTwoEvents.length).toBeGreaterThan(0);

    const tenantOneTaskId = tenantOneTask.json().data.id as string;
    const tenantTwoTaskId = tenantTwoTask.json().data.id as string;

    const tenantOneEventIds = tenantOneEvents
      .map((body) => JSON.parse(body) as { id?: number; entity_id?: string })
      .map((payload) => payload.entity_id)
      .filter(Boolean);
    const tenantTwoEventIds = tenantTwoEvents
      .map((body) => JSON.parse(body) as { id?: number; entity_id?: string })
      .map((payload) => payload.entity_id)
      .filter(Boolean);

    expect(tenantOneEventIds).toContain(tenantOneTaskId);
    expect(tenantOneEventIds).not.toContain(tenantTwoTaskId);
    expect(tenantTwoEventIds).toContain(tenantTwoTaskId);
    expect(tenantTwoEventIds).not.toContain(tenantOneTaskId);

    tenantOneServer.close();
    tenantTwoServer.close();
  });
});
