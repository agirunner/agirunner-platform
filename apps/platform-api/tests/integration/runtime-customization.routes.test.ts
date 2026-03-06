import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

interface ObservedRequest {
  method: string;
  path: string;
  apiKey: string;
  body: Record<string, unknown>;
}

describe('runtime customization routes', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let runtimeServer: ReturnType<typeof createServer>;
  let runtimeBaseUrl = '';
  let adminKey: string;
  let agentKey: string;
  let observedRequests: ObservedRequest[] = [];
  const previousEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    runtimeServer = createRuntimeServer((request) => {
      observedRequests.push(request);
      if (
        request.path === '/v1/runtime/customizations/builds/build-accepted' &&
        request.method === 'GET'
      ) {
        return { status: 200, json: { build_id: 'build-accepted', status: 'ready_for_link' } };
      }

      if (request.path === '/v1/runtime/customizations/builds' && request.method === 'POST') {
        return { status: 202, json: { build_id: 'build-accepted', status: 'accepted' } };
      }

      return {
        status: 200,
        json: {
          runtime_state: 'ready',
          configured_digest: 'sha256:base',
          active_digest: 'sha256:base',
        },
      };
    });
    runtimeBaseUrl = await startRuntimeServer(runtimeServer);

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
      'GIT_WEBHOOK_GITHUB_SECRET',
      'RUNTIME_URL',
      'RUNTIME_API_KEY',
    ]) {
      previousEnv[key] = process.env[key];
    }

    process.env.NODE_ENV = 'test';
    process.env.PORT = '8092';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.JWT_EXPIRES_IN = '5m';
    process.env.JWT_REFRESH_EXPIRES_IN = '1h';
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '200';
    process.env.GIT_WEBHOOK_GITHUB_SECRET = 'runtime-customization-secret';
    process.env.RUNTIME_URL = runtimeBaseUrl;
    process.env.RUNTIME_API_KEY = 'runtime-api-key-for-tests';

    adminKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'admin',
        ownerType: 'user',
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).apiKey;

    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'runtime-agent',ARRAY['ts'],'active',30)`,
      [agentId, tenantId],
    );

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
    await app.close();
    await stopRuntimeServer(runtimeServer);
    await stopTestDatabase(db);

    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it('allows admin callers to read runtime customization status through the proxy', async () => {
    observedRequests = [];

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/runtime/customizations/status',
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      runtime_state: 'ready',
      configured_digest: 'sha256:base',
      active_digest: 'sha256:base',
    });
    expect(observedRequests).toEqual([
      {
        method: 'GET',
        path: '/v1/runtime/customizations/status',
        apiKey: 'runtime-api-key-for-tests',
        body: {},
      },
    ]);
  });

  it('blocks non-admin callers before forwarding runtime customization requests', async () => {
    observedRequests = [];

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/runtime/customizations/builds',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        manifest: { template: 'base' },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(observedRequests).toEqual([]);
  });

  it('forwards build create and build status requests to the runtime with JSON payloads', async () => {
    observedRequests = [];

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/runtime/customizations/builds',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        manifest: { template: 'base' },
        deployment_target: 'staging',
      },
    });

    const statusResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/runtime/customizations/builds/build-accepted',
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(createResponse.statusCode).toBe(202);
    expect(createResponse.json().data).toMatchObject({
      build_id: 'build-accepted',
      status: 'accepted',
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json().data).toMatchObject({
      build_id: 'build-accepted',
      status: 'ready_for_link',
    });
    expect(observedRequests).toEqual([
      {
        method: 'POST',
        path: '/v1/runtime/customizations/builds',
        apiKey: 'runtime-api-key-for-tests',
        body: {
          manifest: { template: 'base' },
          deployment_target: 'staging',
        },
      },
      {
        method: 'GET',
        path: '/v1/runtime/customizations/builds/build-accepted',
        apiKey: 'runtime-api-key-for-tests',
        body: {},
      },
    ]);
  });
});

function createRuntimeServer(
  handler: (request: ObservedRequest) => { status: number; json?: Record<string, unknown> },
) {
  return createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk.toString();
    });

    request.on('end', () => {
      const result = handler({
        method: String(request.method ?? ''),
        path: String(request.url ?? ''),
        apiKey: String(request.headers['x-api-key'] ?? ''),
        body: parseRequestBody(body),
      });
      response.writeHead(result.status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(result.json ?? {}));
    });
  });
}

async function startRuntimeServer(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start runtime test server');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function stopRuntimeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function parseRequestBody(body: string): Record<string, unknown> {
  if (body.trim().length === 0) {
    return {};
  }
  return JSON.parse(body) as Record<string, unknown>;
}
