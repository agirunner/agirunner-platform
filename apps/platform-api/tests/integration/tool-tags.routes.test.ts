import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { EventService } from '../../src/services/event-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

const taskConfig = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  TASK_DEFAULT_AUTO_RETRY: false,
  TASK_DEFAULT_MAX_RETRIES: 0,
  TASK_MAX_SUBTASK_DEPTH: 3,
  TASK_MAX_SUBTASKS_PER_PARENT: 20,
};

describe('tool tags and claim matching', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminKey: string;
  let projectId: string;
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
    process.env.PORT = '8098';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.JWT_EXPIRES_IN = '5m';
    process.env.JWT_REFRESH_EXPIRES_IN = '1h';
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '200';

    projectId = (
      await db.pool.query<{ id: string }>(
        `INSERT INTO projects (tenant_id, name, slug, current_spec_version)
         VALUES ($1,'tool-project','tool-project',1)
         RETURNING id`,
        [tenantId],
      )
    ).rows[0].id;
    await db.pool.query(
      `INSERT INTO project_spec_versions (tenant_id, project_id, version, spec, created_by_type, created_by_id)
       VALUES ($1,$2,1,$3::jsonb,'admin','seed')`,
      [
        tenantId,
        projectId,
        JSON.stringify({
          tools: {
            available: ['git', 'file_system_readonly', 'web_search'],
            blocked: ['shell'],
          },
        }),
      ],
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

    agentId = (
      await db.pool.query<{ id: string }>(
        `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, metadata)
         VALUES ($1,$2,'tool-agent',ARRAY['review'],'idle',30,$3::jsonb)
         RETURNING id`,
        [
          randomUUID(),
          tenantId,
          JSON.stringify({
            tools: {
              required: ['git', 'file_system_readonly'],
              optional: ['web_search', 'shell'],
            },
          }),
        ],
      )
    ).rows[0].id;
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

  it('lists built-in and custom tool tags and exposes project tool configuration', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/tools',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        id: 'mcp:exa-search',
        name: 'Exa Search',
        category: 'integration',
      },
    });
    expect(create.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/tools',
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((entry: { id: string }) => entry.id === 'git')).toBe(true);
    expect(list.json().data.some((entry: { id: string }) => entry.id === 'mcp:exa-search')).toBe(true);

    const projectTools = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/tools`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(projectTools.statusCode).toBe(200);
    expect(projectTools.json().data).toEqual({
      available: ['git', 'file_system_readonly', 'web_search'],
      blocked: ['shell'],
    });
  });

  it('filters task claims by required project tools and returns matched tool tags', async () => {
    const taskService = new TaskService(db.pool, new EventService(db.pool), taskConfig);
    const createdTask = await taskService.createTask(
      { id: 'admin', tenantId, scope: 'admin', ownerType: 'user', ownerId: null, keyPrefix: 'admin' },
      {
        title: 'review-task',
        type: 'review',
        project_id: projectId,
        capabilities_required: ['review'],
      },
    );

    const claim = await taskService.claimTask(
      { id: 'agent-key', tenantId, scope: 'agent', ownerType: 'agent', ownerId: agentId, keyPrefix: 'agent' },
      { agent_id: agentId, capabilities: ['review'] },
    );

    expect(claim?.id).toBe(createdTask.id);
    expect((claim as Record<string, unknown>).tools).toEqual({
      matched: ['git', 'file_system_readonly', 'web_search'],
      unavailable_optional: ['shell'],
    });
  });
});
