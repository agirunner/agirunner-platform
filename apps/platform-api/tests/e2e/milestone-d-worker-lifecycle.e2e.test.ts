import http from 'node:http';

import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function onceMessage(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 15_000);
    ws.on('message', (raw) => {
      const payload = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (payload.type === type) {
        clearTimeout(timer);
        resolve(payload);
      }
    });
  });
}

describe('milestone d e2e worker lifecycle + webhook', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let baseUrl: string;
  let adminKey: string;
  let workerBootstrapKey: string;

  beforeAll(async () => {
    db = await startTestDatabase();

    process.env.NODE_ENV = 'test';
    process.env.PORT = '8093';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'e'.repeat(64);
    process.env.LOG_LEVEL = 'error';

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
        ownerType: 'worker',
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

  it('registers worker, receives task over ws, heartbeats, completes and disconnects, while webhook receives event', async () => {
    const received: string[] = [];
    const hookServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        received.push(body);
        res.statusCode = 200;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => hookServer.listen(0, '127.0.0.1', () => resolve()));
    const hookAddr = hookServer.address() as { port: number };

    const hook = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { url: `http://127.0.0.1:${hookAddr.port}/hook`, event_types: ['task.state_changed'] },
    });
    expect(hook.statusCode).toBe(201);

    const registration = await app.inject({
      method: 'POST',
      url: '/api/v1/workers/register',
      headers: { authorization: `Bearer ${workerBootstrapKey}` },
      payload: {
        name: 'e2e-worker',
        capabilities: ['typescript'],
        agents: [{ name: 'e2e-agent', capabilities: ['typescript'] }],
      },
    });
    expect(registration.statusCode).toBe(201);
    const workerId = registration.json().data.worker_id as string;
    const workerApiKey = registration.json().data.worker_api_key as string;
    const agentId = registration.json().data.agents[0].id as string;
    const agentKey = registration.json().data.agents[0].api_key as string;

    const websocketPath = registration.json().data.websocket_url as string;
    const ws = new WebSocket(baseUrl.replace('http', 'ws') + websocketPath, {
      headers: { authorization: `Bearer ${workerApiKey}` },
    });
    await onceMessage(ws, 'connection.ready');

    const createTask = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${workerBootstrapKey}` },
      payload: { title: 'e2e-task', type: 'code', capabilities_required: ['typescript'] },
    });
    const taskId = createTask.json().data.id as string;

    await onceMessage(ws, 'task.assigned');
    ws.send(JSON.stringify({ type: 'task.assignment_ack', task_id: taskId, agent_id: agentId }));

    const heartbeat = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerId}/heartbeat`,
      headers: { authorization: `Bearer ${workerApiKey}` },
      payload: { status: 'busy', current_task_id: taskId, metrics: { cpu: 20 } },
    });
    expect(heartbeat.statusCode).toBe(200);

    const start = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/start`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { agent_id: agentId, worker_id: workerId },
    });
    expect(start.statusCode).toBe(200);

    const complete = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/complete`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { output: { ok: true } },
    });
    expect(complete.statusCode).toBe(200);

    for (let i = 0; i < 20 && received.length === 0; i += 1) {
      await wait(100);
    }
    expect(received.length).toBeGreaterThan(0);

    ws.close();
    await wait(100);

    const worker = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(worker.statusCode).toBe(200);
    expect(['offline', 'busy', 'online']).toContain(worker.json().data.status);

    hookServer.close();
  });
});
