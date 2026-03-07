import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';
const testPort = '8093';
const testJwtSecret = 'x'.repeat(64);
const testWebhookSecret = 'k'.repeat(64);
const artifactTestPipelineName = 'artifact-pipeline';
const artifactTestAgentName = 'artifact-agent';
const artifactTestTaskTitle = 'artifact-task';
const artifactTestCapability = 'ts';
const artifactTestKeyTtlMs = 60_000;
const artifactRetentionDays = 7;
const artifactContentType = 'application/json';
const artifactRelativePath = 'reports/result.json';
const artifactPayload = '{"ok":true}';

describe('task artifact routes', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let agentKey: string;
  let artifactRoot: string;
  let taskId: string;
  let pipelineId: string;
  const previousEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    db = await startTestDatabase();
    artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'agentbaton-platform-artifacts-'));

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
      'ARTIFACT_STORAGE_BACKEND',
      'ARTIFACT_LOCAL_ROOT',
    ]) {
      previousEnv[key] = process.env[key];
    }

    process.env.NODE_ENV = 'test';
    process.env.PORT = testPort;
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = testJwtSecret;
    process.env.WEBHOOK_ENCRYPTION_KEY = testWebhookSecret;
    process.env.JWT_EXPIRES_IN = '5m';
    process.env.JWT_REFRESH_EXPIRES_IN = '1h';
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '200';
    process.env.ARTIFACT_STORAGE_BACKEND = 'local';
    process.env.ARTIFACT_LOCAL_ROOT = artifactRoot;

    pipelineId = randomUUID();
    taskId = randomUUID();
    const agentId = randomUUID();

    await db.pool.query(
      `INSERT INTO pipelines (id, tenant_id, name, metadata, state)
       VALUES ($1,$2,$3,$4::jsonb,'active')`,
      [
        pipelineId,
        tenantId,
        artifactTestPipelineName,
        JSON.stringify({ artifact_retention: { mode: 'days', days: artifactRetentionDays } }),
      ],
    );
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES ($1,$2,$3,ARRAY[$4],'busy',30,NULL)`,
      [agentId, tenantId, artifactTestAgentName, artifactTestCapability],
    );
    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, pipeline_id, title, type, state, assigned_agent_id)
       VALUES ($1,$2,$3,$4,'code','running',$5)`,
      [taskId, tenantId, pipelineId, artifactTestTaskTitle, agentId],
    );
    await db.pool.query('UPDATE agents SET current_task_id = $3 WHERE tenant_id = $1 AND id = $2', [
      tenantId,
      agentId,
      taskId,
    ]);

    agentKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'agent',
        ownerType: 'agent',
        ownerId: agentId,
        expiresAt: new Date(Date.now() + artifactTestKeyTtlMs),
      })
    ).apiKey;

    app = await buildApp();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (db) {
      await stopTestDatabase(db);
    }
    if (artifactRoot) {
      await rm(artifactRoot, { recursive: true, force: true });
    }

    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it('uploads, lists, downloads, and deletes task artifacts with pipeline retention metadata', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/artifacts`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        path: artifactRelativePath,
        content_base64: Buffer.from(artifactPayload, 'utf8').toString('base64'),
        content_type: artifactContentType,
        metadata: { source: 'integration-test' },
      },
    });

    expect(upload.statusCode).toBe(201);
    const created = upload.json().data;
    expect(created.logical_path).toBe(`artifact:${pipelineId}/${artifactRelativePath}`);
    expect(created.content_type).toBe(artifactContentType);
    expect(created.retention_policy).toEqual({ mode: 'days', days: artifactRetentionDays });
    expect(created.expires_at).not.toBeNull();

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${taskId}/artifacts`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].id).toBe(created.id);

    const download = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${taskId}/artifacts/${created.id}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain(artifactContentType);
    expect(download.body).toBe(artifactPayload);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${taskId}/artifacts/${created.id}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(remove.statusCode).toBe(204);

    const emptyList = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${taskId}/artifacts`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(emptyList.statusCode).toBe(200);
    expect(emptyList.json().data).toEqual([]);
  });
});
