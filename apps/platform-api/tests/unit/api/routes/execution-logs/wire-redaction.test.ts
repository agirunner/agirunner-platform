import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'operator',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
}));

vi.mock('../../../../../src/auth/rbac.js', () => ({
  withRole: () => async () => {},
}));

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
import { createExecutionLogsLogService, unsafeRow } from './support.js';

describe('execution-logs route helpers', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  async function registerRoutes() {
    const { executionLogRoutes } = await import('../../../../../src/api/routes/execution-logs/execution-logs.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('config', { EVENT_STREAM_KEEPALIVE_INTERVAL_MS: 1000 });
    app.decorate('logStreamService', { subscribe: vi.fn(() => () => {}) });
    app.decorate('logService', createExecutionLogsLogService({
      query: vi.fn().mockResolvedValue({
        data: [unsafeRow],
        pagination: {
          per_page: 100,
          has_more: false,
          next_cursor: null,
          prev_cursor: null,
        },
      }),
      getById: vi.fn().mockResolvedValue(unsafeRow),
      export: vi.fn(async function* () {
        yield unsafeRow;
      }),
    }));

    await app.register(executionLogRoutes);
  }

  it('redacts queried log payloads on the JSON wire', async () => {
    await registerRoutes();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('sk-live-secret');
    expect(response.body).not.toContain('Bearer top-secret');
    expect(response.body).not.toContain('secret:OPENAI_API_KEY');
    expect(response.body).toContain('[REDACTED]');

    const payload = response.json();
    expect(payload.data[0].payload.api_key).toBe('[REDACTED]');
    expect(payload.data[0].payload.nested.authorization).toBe('[REDACTED]');
    expect(payload.data[0].payload.nested.secret_ref).toBe('[REDACTED]');
    expect(payload.data[0].error.message).toBe('[REDACTED]');
  });

  it('returns summary rows without payload bodies when detail=summary is requested', async () => {
    await registerRoutes();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs?detail=summary',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.data[0].payload).toBeNull();
    expect(payload.data[0].error).toEqual({
      code: 'AUTH_FAILED',
      message: '[REDACTED]',
    });
    expect(payload.data[0].execution_backend).toBe('runtime_plus_task');
    expect(payload.data[0].tool_owner).toBe('task');
    expect(response.body).not.toContain('nested');
  });

  it('returns a single full log entry by id for lazy detail loading', async () => {
    await registerRoutes();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs/1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.data.id).toBe('1');
    expect(payload.data.payload.nested.safe).toBe('visible');
    expect(payload.data.payload.api_key).toBe('[REDACTED]');
    expect(payload.data.payload.predecessor_handoff_resolution_present).toBe(true);
    expect(payload.data.payload.predecessor_handoff_source).toBe('local_work_item');
    expect(payload.data.payload.workspace_memory_index_present).toBe(true);
    expect(payload.data.payload.workspace_artifact_index_present).toBe(true);
    expect(payload.data.payload.max_output_tokens_omission_reason).toBe(
      'not_supplied_in_task_contract',
    );
  });

  it('redacts exported logs on the JSON wire', async () => {
    await registerRoutes();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs/export?format=json',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).not.toContain('sk-live-secret');
    expect(response.body).not.toContain('Bearer top-secret');
    expect(response.body).not.toContain('secret:OPENAI_API_KEY');
    expect(response.body).toContain('[REDACTED]');
  });

  it('redacts exported logs on the CSV wire', async () => {
    await registerRoutes();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/logs/export?format=csv',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.body).toContain('payload');
    expect(response.body).not.toContain('sk-live-secret');
    expect(response.body).not.toContain('Bearer top-secret');
    expect(response.body).not.toContain('secret:OPENAI_API_KEY');
    expect(response.body).toContain('[REDACTED]');
  });
});
