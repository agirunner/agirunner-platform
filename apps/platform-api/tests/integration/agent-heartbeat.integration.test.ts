import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { AgentService } from '../../src/services/agent-service.js';
import { EventService } from '../../src/services/event-service.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

const testConfig = {
  AGENT_HEARTBEAT_GRACE_PERIOD_MS: 300000,
  AGENT_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: 60,
  AGENT_KEY_EXPIRY_MS: 31536000000,
  AGENT_HEARTBEAT_TOLERANCE_MS: 2000,
};

describe('agent heartbeat enum handling', () => {
  let db: TestDatabase;
  let agentService: AgentService;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const previousEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    db = await startTestDatabase();
    agentService = new AgentService(db.pool, new EventService(db.pool), testConfig);

    for (const key of ['NODE_ENV', 'PORT', 'DATABASE_URL', 'JWT_SECRET', 'WEBHOOK_ENCRYPTION_KEY', 'LOG_LEVEL', 'RATE_LIMIT_MAX_PER_MINUTE']) {
      previousEnv[key] = process.env[key];
    }

    process.env.NODE_ENV = 'test';
    process.env.PORT = '8087';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '200';

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

  it('service heartbeat sets agent status to active when no task is assigned', async () => {
    const agentId = randomUUID();

    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES ($1,$2,'hb-active',ARRAY['ts'],'idle',30,NULL)`,
      [agentId, tenantId],
    );

    const identity = {
      id: 'service-heartbeat',
      tenantId,
      scope: 'agent' as const,
      ownerType: 'agent' as const,
      ownerId: agentId,
      keyPrefix: 'ab_agent_hb_service',
    };

    const response = await agentService.heartbeat(identity, agentId);
    expect(response).toEqual({ ack: true, status: 'active' });

    const persisted = await db.pool.query('SELECT status FROM agents WHERE tenant_id = $1 AND id = $2', [tenantId, agentId]);
    expect(persisted.rows[0].status).toBe('active');
  });

  it('service heartbeat keeps agent status busy when a task is assigned', async () => {
    const taskId = randomUUID();
    const agentId = randomUUID();

    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, priority, state)
       VALUES ($1,$2,'heartbeat-task','code','normal','claimed')`,
      [taskId, tenantId],
    );

    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES ($1,$2,'hb-busy',ARRAY['ts'],'busy',30,$3)`,
      [agentId, tenantId, taskId],
    );

    const identity = {
      id: 'service-heartbeat-busy',
      tenantId,
      scope: 'agent' as const,
      ownerType: 'agent' as const,
      ownerId: agentId,
      keyPrefix: 'ab_agent_hb_busy',
    };

    const response = await agentService.heartbeat(identity, agentId);
    expect(response).toEqual({ ack: true, status: 'busy' });

    const persisted = await db.pool.query('SELECT status FROM agents WHERE tenant_id = $1 AND id = $2', [tenantId, agentId]);
    expect(persisted.rows[0].status).toBe('busy');
  });

  it('heartbeat endpoint returns busy status without enum casting errors', async () => {
    const taskId = randomUUID();
    const agentId = randomUUID();

    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, type, priority, state)
       VALUES ($1,$2,'heartbeat-endpoint-task','code','normal','running')`,
      [taskId, tenantId],
    );

    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES ($1,$2,'hb-endpoint',ARRAY['ts'],'busy',30,$3)`,
      [agentId, tenantId, taskId],
    );

    const agentKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'agent',
        ownerType: 'agent',
        ownerId: agentId,
        expiresAt: new Date(Date.now() + 600_000),
      })
    ).apiKey;

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/heartbeat`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ ack: true, status: 'busy' });
  });
});
