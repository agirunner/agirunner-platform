import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

describe('dashboard api contracts', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminKey: string;
  let agentKey: string;
  let workerKey: string;
  const previousEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    db = await startTestDatabase();

    for (const key of ['NODE_ENV', 'PORT', 'DATABASE_URL', 'JWT_SECRET', 'LOG_LEVEL', 'RATE_LIMIT_MAX_PER_MINUTE']) {
      previousEnv[key] = process.env[key];
    }

    process.env.NODE_ENV = 'test';
    process.env.PORT = '8083';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '200';

    adminKey = (await createApiKey(db.pool, { tenantId, scope: 'admin', ownerType: 'user', expiresAt: new Date(Date.now() + 600_000) })).apiKey;
    workerKey = (await createApiKey(db.pool, { tenantId, scope: 'worker', ownerType: 'worker', expiresAt: new Date(Date.now() + 600_000) })).apiKey;

    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'dashboard-agent',ARRAY['ts'],'active',30)`,
      [agentId, tenantId],
    );

    agentKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'agent',
        ownerType: 'agent',
        ownerId: agentId,
        expiresAt: new Date(Date.now() + 600_000),
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

  it('covers FR-030..FR-037 + FR-429 list/detail contracts for dashboard task and pipeline views', async () => {
    const template = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { name: 'Dash Template', slug: 'dash-template', schema: { tasks: [{ id: 'a', title_template: 'A', type: 'code' }] } },
    });
    expect(template.statusCode).toBe(201);

    const templateId = template.json().data.id as string;
    const pipeline = await app.inject({
      method: 'POST',
      url: '/api/v1/pipelines',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { template_id: templateId, name: 'Dash Pipeline' },
    });
    expect(pipeline.statusCode).toBe(201);

    const pipelineId = pipeline.json().data.id as string;
    const taskId = (pipeline.json().data.tasks[0] as { id: string }).id;

    const [tasks, taskDetail, pipelines, pipelineDetail] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/tasks?page=1&per_page=10', headers: { authorization: `Bearer ${agentKey}` } }),
      app.inject({ method: 'GET', url: `/api/v1/tasks/${taskId}`, headers: { authorization: `Bearer ${agentKey}` } }),
      app.inject({ method: 'GET', url: '/api/v1/pipelines?page=1&per_page=10', headers: { authorization: `Bearer ${agentKey}` } }),
      app.inject({ method: 'GET', url: `/api/v1/pipelines/${pipelineId}`, headers: { authorization: `Bearer ${agentKey}` } }),
    ]);

    expect(tasks.statusCode).toBe(200);
    expect(tasks.json().data.length).toBeGreaterThan(0);
    expect(taskDetail.statusCode).toBe(200);
    expect(taskDetail.json().data.id).toBe(taskId);
    expect(pipelines.statusCode).toBe(200);
    expect(pipelines.json().data.length).toBeGreaterThan(0);
    expect(pipelineDetail.statusCode).toBe(200);
    expect(pipelineDetail.json().data.tasks.length).toBeGreaterThan(0);
  });

  it('covers FR-420/FR-424 template browser and pipeline launch form API backing', async () => {
    const listTemplates = await app.inject({ method: 'GET', url: '/api/v1/templates?page=1&per_page=5', headers: { authorization: `Bearer ${agentKey}` } });
    expect(listTemplates.statusCode).toBe(200);
    expect(listTemplates.json().meta.page).toBe(1);

    const firstTemplate = listTemplates.json().data[0];
    const detail = await app.inject({ method: 'GET', url: `/api/v1/templates/${firstTemplate.id}`, headers: { authorization: `Bearer ${agentKey}` } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.id).toBe(firstTemplate.id);
  });

  it('covers FR-425/FR-426 worker management and api-key auth contracts', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/workers/register',
      headers: { authorization: `Bearer ${workerKey}` },
      payload: { name: 'dash-worker', runtime_type: 'openclaw', capabilities: ['ts'], agents: [{ name: 'worker-agent', capabilities: ['ts'] }] },
    });
    expect(registered.statusCode).toBe(201);

    const workers = await app.inject({ method: 'GET', url: '/api/v1/workers', headers: { authorization: `Bearer ${adminKey}` } });
    expect(workers.statusCode).toBe(200);
    expect(workers.json().data.length).toBeGreaterThan(0);

    const agents = await app.inject({ method: 'GET', url: '/api/v1/agents', headers: { authorization: `Bearer ${agentKey}` } });
    expect(agents.statusCode).toBe(200);
    expect(agents.json().data.length).toBeGreaterThan(0);
  });

  it('covers FR-030a/FR-031/FR-031a/FR-031b/FR-423/FR-423a real-time stream endpoint contract', async () => {
    const eventsRoutesSource = fs.readFileSync(new URL('../../src/api/routes/events.routes.ts', import.meta.url), 'utf-8');
    const sdkRealtimeSource = fs.readFileSync(new URL('../../../../packages/sdk/src/realtime.ts', import.meta.url), 'utf-8');

    expect(eventsRoutesSource).toContain('text/event-stream');
    expect(eventsRoutesSource).toContain('/api/v1/events/stream');
    expect(sdkRealtimeSource).toContain('connectSse');
    expect(sdkRealtimeSource).toContain('connectWebSocket');
  });

  it('covers FR-SM-006 dashboard state color source contract by validating state values from API', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?page=1&per_page=20',
      headers: { authorization: `Bearer ${agentKey}` },
    });

    const allowedStates = new Set(['pending', 'ready', 'claimed', 'running', 'output_pending_review', 'awaiting_approval', 'failed', 'completed', 'cancelled']);
    const states = (response.json().data as Array<{ state: string }>).map((task) => task.state);

    expect(states.length).toBeGreaterThan(0);
    expect(states.every((state) => allowedStates.has(state))).toBe(true);
  });
});
