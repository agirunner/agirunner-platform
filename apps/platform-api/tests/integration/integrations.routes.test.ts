import http from 'node:http';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';
const testPort = '8094';
const testJwtSecret = 'x'.repeat(64);
const testWebhookSecret = 'k'.repeat(64);
const testPublicBaseUrl = 'http://platform.test';
const integrationSecret = 'adapter-secret-token';
const routePipelineName = 'integration-pipeline';

interface CapturedRequest {
  headers: http.IncomingHttpHeaders;
  body: string;
}

async function waitForDeliveryRecord(
  db: TestDatabase,
  tenantId: string,
  adapterId: string,
): Promise<{ status: string; attempts: number; last_status_code: number | null }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await db.pool.query<{
      status: string;
      attempts: number;
      last_status_code: number | null;
    }>(
      `SELECT status, attempts, last_status_code
         FROM integration_adapter_deliveries
        WHERE tenant_id = $1
          AND adapter_id = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId, adapterId],
    );

    if (result.rowCount && result.rows[0].status !== 'pending') {
      return result.rows[0];
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error('Timed out waiting for integration delivery record');
}

async function waitForDeliveryCount(
  db: TestDatabase,
  tenantId: string,
  adapterId: string,
  expectedCount: number,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await db.pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM integration_adapter_deliveries
        WHERE tenant_id = $1
          AND adapter_id = $2`,
      [tenantId, adapterId],
    );

    if (Number(result.rows[0]?.total ?? '0') >= expectedCount) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error('Timed out waiting for follow-on integration deliveries');
}

function waitForRequest(server: http.Server): Promise<CapturedRequest> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for integration delivery'));
    }, 5_000);

    server.once('request', (request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        response.statusCode = 202;
        response.end('ok', () => {
          clearTimeout(timeout);
          setImmediate(() => {
            resolve({
              headers: request.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        });
      });
      request.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  });
}

describe('integration adapter routes', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminKey: string;
  let pipelineId: string;
  let deliveryServer: http.Server;
  let deliveryBaseUrl: string;
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
      'PLATFORM_PUBLIC_BASE_URL',
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
    process.env.PLATFORM_PUBLIC_BASE_URL = testPublicBaseUrl;

    pipelineId = randomUUID();
    await db.pool.query(
      `INSERT INTO pipelines (id, tenant_id, name, metadata, state)
       VALUES ($1,$2,$3,'{}'::jsonb,'active')`,
      [pipelineId, tenantId, routePipelineName],
    );

    adminKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'admin',
        ownerType: 'user',
        expiresAt: new Date(Date.now() + 600_000),
      })
    ).apiKey;

    deliveryServer = http.createServer();
    await new Promise<void>((resolve) => {
      deliveryServer.listen(0, '127.0.0.1', () => resolve());
    });
    const address = deliveryServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind delivery test server');
    }
    deliveryBaseUrl = `http://127.0.0.1:${address.port}`;

    app = await buildApp();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (deliveryServer) {
      deliveryServer.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => {
        deliveryServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
    if (db) {
      await stopTestDatabase(db);
    }

    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it('creates, lists, updates, and deletes integration adapters without exposing secrets', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        kind: 'webhook',
        pipeline_id: pipelineId,
        subscriptions: ['task.*'],
        config: {
          url: `${deliveryBaseUrl}/events`,
          secret: integrationSecret,
          headers: { 'x-source': 'integration-test' },
        },
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json().data;
    expect(created.config).toEqual({
      url: `${deliveryBaseUrl}/events`,
      headers: { 'x-source': 'integration-test' },
      secret_configured: true,
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().data).toEqual([
      expect.objectContaining({
        id: created.id,
        pipeline_id: pipelineId,
        subscriptions: ['task.*'],
        config: created.config,
      }),
    ]);

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/integrations/${created.id}`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { subscriptions: ['pipeline.*'], is_active: false },
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().data.subscriptions).toEqual(['pipeline.*']);
    expect(patchResponse.json().data.is_active).toBe(false);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/integrations/${created.id}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(deleteResponse.statusCode).toBe(204);
  });

  it('dispatches matching events through the event stream and records delivered attempts', async () => {
    const taskId = randomUUID();
    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, pipeline_id, title, type, state, requires_approval)
       VALUES ($1,$2,$3,'approval-task','review','awaiting_approval',true)`,
      [taskId, tenantId, pipelineId],
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        kind: 'webhook',
        pipeline_id: pipelineId,
        subscriptions: ['task.state_changed'],
        config: {
          url: `${deliveryBaseUrl}/events`,
          secret: integrationSecret,
          headers: { 'x-source': 'integration-test' },
        },
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const adapterId = createResponse.json().data.id as string;
    const requestPromise = waitForRequest(deliveryServer);

    await app.eventService.emit({
      tenantId,
      type: 'task.state_changed',
      entityType: 'task',
      entityId: taskId,
      actorType: 'system',
      data: { pipeline_id: pipelineId, from_state: 'pending', to_state: 'awaiting_approval' },
    });

    const delivered = await requestPromise;
    const parsed = JSON.parse(delivered.body) as {
      pipeline_id?: string;
      type?: string;
      approval_actions?: Record<string, { url: string }>;
    };

    expect(delivered.headers['x-agentbaton-event']).toBe('task.state_changed');
    expect(delivered.headers['x-agentbaton-signature']).toBeTypeOf('string');
    expect(parsed.pipeline_id).toBe(pipelineId);
    expect(parsed.type).toBe('task.state_changed');
    expect(parsed.approval_actions?.approve.url).toContain('/api/v1/integrations/actions/');

    const deliveryRecord = await waitForDeliveryRecord(db, tenantId, adapterId);

    expect(deliveryRecord).toEqual({
      status: 'delivered',
      attempts: 1,
      last_status_code: 202,
    });

    const approvePath = new URL(parsed.approval_actions!.approve.url).pathname;
    const approveResponse = await app.inject({
      method: 'POST',
      url: approvePath,
      payload: {},
    });

    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.json().data.state).toBe('ready');
    await waitForDeliveryCount(db, tenantId, adapterId, 2);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/integrations/${adapterId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(deleteResponse.statusCode).toBe(204);
  });

  it('formats approval notifications for slack adapters with approve and reject buttons', async () => {
    const taskId = randomUUID();
    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, pipeline_id, title, type, state, requires_approval)
       VALUES ($1,$2,$3,'slack-approval-task','review','awaiting_approval',true)`,
      [taskId, tenantId, pipelineId],
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        kind: 'slack',
        pipeline_id: pipelineId,
        subscriptions: ['task.state_changed'],
        config: {
          webhook_url: `${deliveryBaseUrl}/slack`,
          channel: '#approvals',
          username: 'AgentBaton',
        },
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const adapterId = createResponse.json().data.id as string;
    const requestPromise = waitForRequest(deliveryServer);

    await app.eventService.emit({
      tenantId,
      type: 'task.state_changed',
      entityType: 'task',
      entityId: taskId,
      actorType: 'system',
      data: { pipeline_id: pipelineId, from_state: 'pending', to_state: 'awaiting_approval' },
    });

    const delivered = await requestPromise;
    const payload = JSON.parse(delivered.body) as {
      channel?: string;
      username?: string;
      text?: string;
      blocks?: Array<Record<string, unknown>>;
    };

    expect(payload.channel).toBe('#approvals');
    expect(payload.username).toBe('AgentBaton');
    expect(payload.text).toContain('awaiting approval');
    expect(payload.blocks).toHaveLength(2);

    const actionsBlock = payload.blocks?.[1] as { elements?: Array<{ text?: { text?: string }; url?: string }> };
    expect(actionsBlock.elements?.map((element) => element.text?.text)).toEqual(['Approve', 'Reject']);
    expect(actionsBlock.elements?.every((element) => element.url?.includes('/api/v1/integrations/actions/'))).toBe(
      true,
    );

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/integrations/${adapterId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(deleteResponse.statusCode).toBe(204);
  });

  it('exports lifecycle events through otlp_http adapters as trace envelopes', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        kind: 'otlp_http',
        pipeline_id: pipelineId,
        subscriptions: ['task.state_changed'],
        config: {
          endpoint: `${deliveryBaseUrl}/otlp`,
          headers: { authorization: 'Bearer collector-token' },
          service_name: 'agentbaton-platform-test',
        },
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const adapterId = createResponse.json().data.id as string;
    const requestPromise = waitForRequest(deliveryServer);

    await app.eventService.emit({
      tenantId,
      type: 'task.state_changed',
      entityType: 'task',
      entityId: randomUUID(),
      actorType: 'system',
      data: {
        pipeline_id: pipelineId,
        to_state: 'running',
        task_type: 'code',
        agent_id: 'agent-1',
        agent_framework: 'codex',
        gen_ai_system: 'openai',
        gen_ai_model: 'gpt-5',
      },
    });

    const delivered = await requestPromise;
    const payload = JSON.parse(delivered.body) as {
      resourceSpans?: Array<{
        resource?: { attributes?: Array<{ key?: string; value?: { stringValue?: string } }> };
        scopeSpans?: Array<{
          spans?: Array<{ name?: string; traceId?: string; attributes?: Array<{ key?: string; value?: { stringValue?: string } }> }>;
        }>;
      }>;
    };

    expect(delivered.headers.authorization).toBe('Bearer collector-token');
    expect(payload.resourceSpans?.[0]?.resource?.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'service.name', value: { stringValue: 'agentbaton-platform-test' } }),
      ]),
    );
    expect(payload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0]?.name).toBe('task.state_changed');
    expect(payload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0]?.traceId).toHaveLength(32);
    expect(payload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0]?.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'agentbaton.pipeline.id', value: { stringValue: pipelineId } }),
        expect.objectContaining({ key: 'agentbaton.task.type', value: { stringValue: 'code' } }),
        expect.objectContaining({ key: 'gen_ai.system', value: { stringValue: 'openai' } }),
      ]),
    );

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/integrations/${adapterId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(deleteResponse.statusCode).toBe(204);
  });
});
