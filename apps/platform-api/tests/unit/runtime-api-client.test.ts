import { createServer, type IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import { RuntimeApiClient } from '../../src/built-in/runtime-api-client.js';

async function withHttpServer(
  handler: (request: IncomingMessage, body: string) => { status: number; json?: Record<string, unknown> },
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk.toString();
    });

    request.on('end', () => {
      const handlerResult = handler(request, body);
      response.writeHead(handlerResult.status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(handlerResult.json ?? {}));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start HTTP test server');
  }

  try {
    await run(address.port);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }),
    );
  }
}

describe('RuntimeApiClient', () => {
  it('submits task payload using the runtime contract and auth header', async () => {
    let observedMethod = '';
    let observedUrl = '';
    let observedAuthHeader = '';
    let observedBody: Record<string, unknown> = {};

    await withHttpServer(
      (request, body) => {
        observedMethod = request.method ?? '';
        observedUrl = request.url ?? '';
        observedAuthHeader = String(request.headers.authorization ?? '');
        observedBody = JSON.parse(body) as Record<string, unknown>;

        return {
          status: 200,
          json: {
            task_id: 'task-runtime-1',
            status: 'accepted',
          },
        };
      },
      async (port) => {
        const client = new RuntimeApiClient({
          runtimeUrl: `http://127.0.0.1:${port}`,
          runtimeApiKey: 'runtime-secret-token',
        });

        const response = await client.submitTask(
          {
            id: 'task-runtime-1',
            pipeline_id: 'pipe-1',
            tenant_id: 'tenant-1',
            role: 'developer',
            input: { objective: 'ship S1' },
            context_stack: { reviewer: { approved: true } },
            upstream_outputs: { architect: { design: 'v1.05' } },
            resource_bindings: [{ type: 'git_repository', url: 'ssh://example/repo.git' }],
            role_config: { planning_mode: true },
            environment: { network_policy: 'restricted' },
          },
          {
            llmProvider: 'openai',
            llmModel: 'gpt-4.1',
            llmApiKey: 'llm-key',
          },
        );

        expect(response).toMatchObject({ task_id: 'task-runtime-1', status: 'accepted' });
      },
    );

    expect(observedMethod).toBe('POST');
    expect(observedUrl).toBe('/api/v1/tasks');
    expect(observedAuthHeader).toBe('Bearer runtime-secret-token');
    expect(observedBody).toMatchObject({
      task_id: 'task-runtime-1',
      pipeline_id: 'pipe-1',
      tenant_id: 'tenant-1',
      role: 'developer',
      context_stack: { reviewer: { approved: true } },
      upstream_outputs: { architect: { design: 'v1.05' } },
      resource_bindings: [{ type: 'git_repository', url: 'ssh://example/repo.git' }],
      credentials: {
        llm_provider: 'openai',
        llm_model: 'gpt-4.1',
        llm_api_key: 'llm-key',
      },
    });
  });

  it('waits for terminal runtime status and returns the final task result', async () => {
    const observedCalls: string[] = [];
    let statusPollCount = 0;

    await withHttpServer(
      (request) => {
        const url = String(request.url ?? '');
        observedCalls.push(`${String(request.method ?? '')} ${url}`);

        if (url === '/api/v1/tasks' && request.method === 'POST') {
          return {
            status: 202,
            json: {
              task_id: 'task-runtime-final',
              status: 'accepted',
            },
          };
        }

        statusPollCount += 1;
        if (statusPollCount === 1) {
          return {
            status: 200,
            json: {
              task_id: 'task-runtime-final',
              status: 'running',
            },
          };
        }

        return {
          status: 200,
          json: {
            task_id: 'task-runtime-final',
            status: 'completed',
            result: {
              status: 'completed',
              output: { summary: 'done' },
              metrics: { total_cost_usd: 0.01 },
            },
          },
        };
      },
      async (port) => {
        const client = new RuntimeApiClient({
          runtimeUrl: `http://127.0.0.1:${port}`,
          requestTimeoutMs: 2_000,
        });

        const result = await client.executeTask({
          id: 'task-runtime-final',
          tenant_id: 'tenant-1',
          role: 'developer',
          input: { objective: 'ship S1' },
        });

        expect(result).toMatchObject({
          task_id: 'task-runtime-final',
          status: 'completed',
          result: {
            output: { summary: 'done' },
            metrics: { total_cost_usd: 0.01 },
          },
        });
      },
    );

    expect(observedCalls).toEqual([
      'POST /api/v1/tasks',
      'GET /api/v1/tasks/task-runtime-final',
      'GET /api/v1/tasks/task-runtime-final',
    ]);
  });

  it('normalizes runtimeUrl values that include /api/v1/tasks endpoint path', async () => {
    let observedPath = '';

    await withHttpServer(
      (request) => {
        observedPath = String(request.url ?? '');
        return {
          status: 200,
          json: {
            task_id: 'task-runtime-normalized',
            status: 'accepted',
          },
        };
      },
      async (port) => {
        const client = new RuntimeApiClient({
          runtimeUrl: `http://127.0.0.1:${port}/api/v1/tasks`,
        });

        await client.submitTask({
          id: 'task-runtime-normalized',
          role: 'developer',
        });
      },
    );

    expect(observedPath).toBe('/api/v1/tasks');
  });

  it('uses contract-aligned POST cancel endpoint by default', async () => {
    const observedCalls: Array<{ method: string; url: string }> = [];

    await withHttpServer(
      (request) => {
        observedCalls.push({
          method: String(request.method ?? ''),
          url: String(request.url ?? ''),
        });

        return {
          status: 200,
          json: { cancelled: true },
        };
      },
      async (port) => {
        const client = new RuntimeApiClient({ runtimeUrl: `http://127.0.0.1:${port}` });
        const result = await client.cancelTask('task-cancel-1');

        expect(result.method).toBe('post-cancel');
        expect(result.response).toMatchObject({ cancelled: true });
      },
    );

    expect(observedCalls).toEqual([{ method: 'POST', url: '/api/v1/tasks/task-cancel-1/cancel' }]);
  });

  it('falls back to legacy DELETE cancel alias when enabled and POST is unsupported', async () => {
    const observedCalls: Array<{ method: string; url: string }> = [];

    await withHttpServer(
      (request) => {
        observedCalls.push({
          method: String(request.method ?? ''),
          url: String(request.url ?? ''),
        });

        if (request.method === 'POST') {
          return { status: 405, json: { error: 'method_not_allowed' } };
        }

        return { status: 200, json: { cancelled: true, via: 'legacy-alias' } };
      },
      async (port) => {
        const client = new RuntimeApiClient({
          runtimeUrl: `http://127.0.0.1:${port}`,
          allowLegacyCancelAlias: true,
        });

        const result = await client.cancelTask('task-cancel-legacy');

        expect(result.method).toBe('delete-legacy');
        expect(result.response).toMatchObject({ cancelled: true, via: 'legacy-alias' });
      },
    );

    expect(observedCalls).toEqual([
      { method: 'POST', url: '/api/v1/tasks/task-cancel-legacy/cancel' },
      { method: 'DELETE', url: '/api/v1/tasks/task-cancel-legacy' },
    ]);
  });

  it('reads runtime task logs and health endpoints', async () => {
    const observedCalls: Array<{ method: string; url: string }> = [];

    await withHttpServer(
      (request) => {
        const method = String(request.method ?? '');
        const url = String(request.url ?? '');
        observedCalls.push({ method, url });

        if (url === '/api/v1/tasks/task-logs-1/logs') {
          return {
            status: 200,
            json: {
              task_id: 'task-logs-1',
              logs: [{ ts: '2026-03-05T00:00:00Z', level: 'info', message: 'running' }],
            },
          };
        }

        return {
          status: 200,
          json: {
            status: 'ok',
            checks: {
              runtime_api: 'ok',
              secret_loader: 'ok',
            },
          },
        };
      },
      async (port) => {
        const client = new RuntimeApiClient({ runtimeUrl: `http://127.0.0.1:${port}` });

        const logs = await client.getTaskLogs('task-logs-1');
        const health = await client.getHealth();

        expect(logs).toMatchObject({
          task_id: 'task-logs-1',
          logs: [{ level: 'info', message: 'running' }],
        });
        expect(health).toMatchObject({
          status: 'ok',
          checks: {
            runtime_api: 'ok',
            secret_loader: 'ok',
          },
        });
      },
    );

    expect(observedCalls).toEqual([
      { method: 'GET', url: '/api/v1/tasks/task-logs-1/logs' },
      { method: 'GET', url: '/health' },
    ]);
  });
});
