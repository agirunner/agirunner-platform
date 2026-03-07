import { createHmac, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

function sign(secret: string, payload: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

describe('webhook task trigger routes', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminKey: string;
  let projectId: string;
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
    process.env.PORT = '8097';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.JWT_EXPIRES_IN = '5m';
    process.env.JWT_REFRESH_EXPIRES_IN = '1h';
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '200';

    projectId = (
      await db.pool.query<{ id: string }>(
        `INSERT INTO projects (tenant_id, name, slug)
         VALUES ($1,'trigger-project','trigger-project')
         RETURNING id`,
        [tenantId],
      )
    ).rows[0].id;

    pipelineId = randomUUID();
    await db.pool.query(
      `INSERT INTO pipelines (id, tenant_id, project_id, name, state)
       VALUES ($1,$2,$3,'trigger-pipeline','active')`,
      [pipelineId, tenantId, projectId],
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

  it('creates triggers and invokes them to create tasks with mapped fields', async () => {
    const secret = 'trigger-secret';
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/task-triggers',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'github-pr-trigger',
        source: 'github',
        project_id: projectId,
        pipeline_id: pipelineId,
        event_header: 'x-github-event',
        event_types: ['pull_request'],
        signature_header: 'x-hub-signature-256',
        signature_mode: 'hmac_sha256',
        secret,
        field_mappings: {
          title: 'pull_request.title',
          description: 'pull_request.body',
          metadata: {
            external_id: 'pull_request.id',
            source_url: 'pull_request.html_url',
          },
          input: {
            repository: 'repository.full_name',
            pr_number: 'pull_request.number',
          },
          dedupe_key: 'pull_request.id',
        },
        defaults: {
          type: 'review',
          priority: 'high',
          role: 'reviewer',
        },
      },
    });

    expect(create.statusCode).toBe(201);
    const triggerId = create.json().data.id as string;

    const payload = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'org/repo' },
      pull_request: {
        id: 12345,
        number: 12,
        title: 'Review PR #12',
        body: 'Please review the implementation.',
        html_url: 'https://example.com/pr/12',
      },
    });

    const invoke = await app.inject({
      method: 'POST',
      url: `/api/v1/task-triggers/${triggerId}/invoke`,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': sign(secret, payload),
      },
      payload,
    });

    expect(invoke.statusCode).toBe(202);
    expect(invoke.json().data).toMatchObject({
      accepted: true,
      created: true,
      event_type: 'pull_request',
    });

    const createdTask = await db.pool.query(
      `SELECT title, type, priority, role, metadata, input, pipeline_id, project_id
         FROM tasks
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId],
    );
    expect(createdTask.rows[0]).toMatchObject({
      title: 'Review PR #12',
      type: 'review',
      priority: 'high',
      role: 'reviewer',
      pipeline_id: pipelineId,
      project_id: projectId,
    });
    expect(createdTask.rows[0].metadata.trigger).toMatchObject({
      source: 'github',
      event_type: 'pull_request',
    });
    expect(createdTask.rows[0].input).toMatchObject({
      repository: 'org/repo',
      pr_number: 12,
    });

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/task-triggers/${triggerId}/invoke`,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': sign(secret, payload),
      },
      payload,
    });

    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.json().data).toMatchObject({
      accepted: true,
      created: false,
      duplicate: true,
    });
  });

  it('rejects invalid signatures and supports trigger list/update/delete', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/task-triggers',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'jira-trigger',
        source: 'jira',
        project_id: projectId,
        signature_header: 'x-shared-secret',
        signature_mode: 'shared_secret',
        secret: 'jira-secret',
        defaults: {
          type: 'custom',
          title: 'fallback',
        },
        field_mappings: {
          title: 'issue.fields.summary',
        },
      },
    });
    expect(create.statusCode).toBe(201);
    const triggerId = create.json().data.id as string;

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/task-triggers',
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((entry: { id: string }) => entry.id === triggerId)).toBe(true);

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/task-triggers/${triggerId}`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        is_active: false,
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data.is_active).toBe(false);

    const invoke = await app.inject({
      method: 'POST',
      url: `/api/v1/task-triggers/${triggerId}/invoke`,
      headers: {
        'content-type': 'application/json',
        'x-shared-secret': 'jira-secret',
      },
      payload: JSON.stringify({
        issue: { fields: { summary: 'Jira event' } },
      }),
    });

    expect(invoke.statusCode).toBe(401);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/task-triggers/${triggerId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json().data).toEqual({ id: triggerId, deleted: true });
  });
});
