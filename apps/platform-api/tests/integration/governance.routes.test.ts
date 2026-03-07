import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { GovernanceService } from '../../src/services/governance-service.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

describe('governance routes', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminKey: string;
  let adminOwnerId: string;
  let agentKey: string;
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
      'GOVERNANCE_RETENTION_JOB_INTERVAL_MS',
    ]) {
      previousEnv[key] = process.env[key];
    }

    process.env.NODE_ENV = 'test';
    process.env.PORT = '8104';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.JWT_EXPIRES_IN = '5m';
    process.env.JWT_REFRESH_EXPIRES_IN = '1h';
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '200';
    process.env.GOVERNANCE_RETENTION_JOB_INTERVAL_MS = '86400000';

    agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'governance-agent',ARRAY['governance'],'idle',30)`,
      [agentId, tenantId],
    );

    adminOwnerId = randomUUID();
    adminKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'admin',
        ownerType: 'user',
        ownerId: adminOwnerId,
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).apiKey;

    agentKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'agent',
        ownerType: 'agent',
        ownerId: agentId,
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).apiKey;

    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
    await stopTestDatabase(db);
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it('records successful mutations and denied admin access in immutable audit logs', async () => {
    const createProject = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: {
        authorization: `Bearer ${adminKey}`,
        'x-request-id': 'req-governance-1',
        'x-forwarded-for': '203.0.113.10',
      },
      payload: {
        name: 'Governance Project',
        slug: `governance-${Date.now()}`,
      },
    });

    expect(createProject.statusCode).toBe(201);
    const projectId = createProject.json().data.id as string;

    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/audit/logs',
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(denied.statusCode).toBe(403);

    const auditLogs = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/logs?action=project.created&resource_id=${projectId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(auditLogs.statusCode).toBe(200);
    expect(auditLogs.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'project.created',
          resource_id: projectId,
          outcome: 'success',
          request_id: 'req-governance-1',
          source_ip: '203.0.113.10',
          actor_id: adminOwnerId,
        }),
      ]),
    );

    const deniedLogs = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/logs?action=auth.request_denied&actor=${agentId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(deniedLogs.statusCode).toBe(200);
    expect(deniedLogs.json().data[0]).toEqual(
      expect.objectContaining({
        action: 'auth.request_denied',
        actor_id: agentId,
        outcome: 'failure',
      }),
    );
  });

  it('stores retention policy updates and legal holds through governance routes', async () => {
    const pipelineId = randomUUID();
    const taskId = randomUUID();
    await db.pool.query(
      `INSERT INTO pipelines (id, tenant_id, name, state)
       VALUES ($1, $2, 'Retention pipeline', 'completed')`,
      [pipelineId, tenantId],
    );
    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, pipeline_id, title, state, completed_at)
       VALUES ($1, $2, $3, 'Retained task', 'completed', now())`,
      [taskId, tenantId, pipelineId],
    );

    const updatePolicy = await app.inject({
      method: 'PUT',
      url: '/api/v1/governance/retention-policy',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        task_archive_after_days: 30,
        task_delete_after_days: 120,
      },
    });
    expect(updatePolicy.statusCode).toBe(200);
    expect(updatePolicy.json().data).toEqual(
      expect.objectContaining({
        task_archive_after_days: 30,
        task_delete_after_days: 120,
      }),
    );

    const putTaskHold = await app.inject({
      method: 'PUT',
      url: `/api/v1/governance/legal-holds/tasks/${taskId}`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { enabled: true },
    });
    expect(putTaskHold.statusCode).toBe(200);
    expect(putTaskHold.json().data).toEqual({ id: taskId, legal_hold: true });

    const putPipelineHold = await app.inject({
      method: 'PUT',
      url: `/api/v1/governance/legal-holds/pipelines/${pipelineId}`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { enabled: true },
    });
    expect(putPipelineHold.statusCode).toBe(200);
    expect(putPipelineHold.json().data).toEqual({ id: pipelineId, legal_hold: true });
  });

  it('enforces task retention while respecting legal hold and records retention actions', async () => {
    const governance = new GovernanceService(app.pgPool, app.auditService, app.config);
    const deletableTaskId = randomUUID();
    const heldTaskId = randomUUID();

    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, title, state, completed_at, legal_hold)
       VALUES
       ($1, $3, 'Delete me', 'completed', now() - interval '400 days', false),
       ($2, $3, 'Keep me', 'completed', now() - interval '400 days', true)`,
      [deletableTaskId, heldTaskId, tenantId],
    );

    await governance.updateRetentionPolicy(
      {
        id: 'governance-admin',
        tenantId,
        scope: 'admin',
        ownerType: 'user',
        ownerId: adminOwnerId,
        keyPrefix: 'k-governance',
      },
      {
        task_archive_after_days: 1,
        task_delete_after_days: 30,
        audit_log_retention_days: 3650,
      },
    );

    const result = await governance.enforceRetentionPolicies();
    expect(result.deletedTasks).toBeGreaterThanOrEqual(1);

    const deletedTask = await db.pool.query('SELECT id FROM tasks WHERE id = $1', [deletableTaskId]);
    const heldTask = await db.pool.query('SELECT id FROM tasks WHERE id = $1', [heldTaskId]);
    expect(deletedTask.rowCount).toBe(0);
    expect(heldTask.rowCount).toBe(1);

    const auditLogs = await app.inject({
      method: 'GET',
      url: '/api/v1/audit/logs?action=task.deleted_by_retention',
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(auditLogs.statusCode).toBe(200);
    expect(auditLogs.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'task.deleted_by_retention',
          resource_id: deletableTaskId,
          actor_type: 'system',
        }),
      ]),
    );
  });
});
