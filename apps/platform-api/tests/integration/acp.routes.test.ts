import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

describe('acp routes', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let bootstrapAgentKey: string;
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
    process.env.PORT = '8104';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.JWT_EXPIRES_IN = '5m';
    process.env.JWT_REFRESH_EXPIRES_IN = '1h';
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '200';

    bootstrapAgentKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'agent',
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

  it('registers ACP agents and bridges claim, heartbeat, and output through normal task lifecycle', async () => {
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/register',
      headers: { authorization: `Bearer ${bootstrapAgentKey}` },
      payload: {
        name: 'acp-coder',
        protocol: 'acp',
        capabilities: ['acp', 'code'],
        acp: {
          transports: ['stdio'],
          session_modes: ['session'],
          capabilities: { file_system: true, terminal: true, diff_display: true },
        },
      },
    });
    expect(registerResponse.statusCode).toBe(201);
    const agentId = registerResponse.json().data.id as string;
    const agentKey = registerResponse.json().data.api_key as string;
    expect(registerResponse.json().data.metadata.protocol).toBe('acp');

    const createTaskResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        title: 'ACP code task',
        type: 'code',
        description: 'Implement the requested change',
        capabilities_required: ['acp'],
        input: {
          workspace: { path: '/workspace/repo' },
          documents: [{ logical_name: 'brief', source: 'repository' }],
        },
      },
    });
    expect(createTaskResponse.statusCode).toBe(201);
    const taskId = createTaskResponse.json().data.id as string;

    const claimResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/acp/claim',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        agent_id: agentId,
        capabilities: ['acp'],
        session: {
          transport: 'stdio',
          mode: 'session',
          workspace_path: '/workspace/repo',
        },
      },
    });
    expect(claimResponse.statusCode).toBe(200);
    const sessionId = claimResponse.json().data.session.id as string;
    expect(claimResponse.json().data.task).toEqual(
      expect.objectContaining({
        id: taskId,
        cwd: '/workspace/repo',
        prompt: 'Implement the requested change',
      }),
    );

    const heartbeatResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/acp/sessions/${sessionId}/heartbeat`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { status: 'active' },
    });
    expect(heartbeatResponse.statusCode).toBe(200);
    expect(heartbeatResponse.json().data.status).toBe('active');

    const outputResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/acp/tasks/${taskId}/output`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        session_id: sessionId,
        agent_id: agentId,
        diff: 'diff --git a/file b/file',
        terminal_output: 'npm test',
        result: { ok: true },
      },
    });
    expect(outputResponse.statusCode).toBe(200);
    expect(outputResponse.json().data.state).toBe('completed');

    const taskResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${taskId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(taskResponse.statusCode).toBe(200);
    expect(taskResponse.json().data.output).toEqual(
      expect.objectContaining({
        protocol: 'acp',
        diff: 'diff --git a/file b/file',
        terminal_output: 'npm test',
        result: { ok: true },
      }),
    );
  });
});
