/**
 * Unit tests for the built-in worker task handler (FR-741, FR-752, FR-754).
 *
 * Proves that the built-in worker can execute tasks via the configured executor
 * and that the handler functions exist and behave correctly.
 */

import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';

import {
  executeTask,
  createBuiltInTaskHandler,
  checkProhibitedOperations,
  connectBuiltInWorkerWebSocket,
  type TaskExecutorConfig,
  type TaskExecutionResult,
  type WorkerRegistration,
  type BuiltInWorkerConfig,
} from '../../src/bootstrap/built-in-worker.js';

const mockRegistration: WorkerRegistration = {
  workerId: 'worker-123',
  workerApiKey: 'ab_worker_testkey',
  websocketUrl: '/ws/workers',
  heartbeatIntervalSeconds: 30,
  agent: {
    agentId: 'agent-123',
    agentApiKey: 'ab_agent_testkey',
    name: 'built-in-worker-agent',
    capabilities: ['general'],
  },
};

const minimalConfig: BuiltInWorkerConfig = {
  apiBaseUrl: 'http://localhost:8080',
  adminApiKey: 'ab_admin_deftest',
  capabilities: ['general'],
  name: 'test-built-in-worker',
  heartbeatIntervalSeconds: 30,
};

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3_000,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

describe('executeTask', () => {
  it('fails closed when runtimeUrl is missing in go-only mode', async () => {
    const config: TaskExecutorConfig = {};
    const task = { id: 'task-abc', type: 'code', title: 'Test task' };

    const result = await executeTask(task, config);

    expect(result.success).toBe(false);
    expect(result.output).toEqual({});
    expect(result.error).toContain('executor.runtimeUrl');
  });

  it('returns parsed runtime output when a go-runtime endpoint is configured', async () => {
    let receivedAuthHeader: string | undefined;
    let receivedBody: Record<string, unknown> | undefined;
    const observedUrls: string[] = [];

    const server = createServer((req, res) => {
      observedUrls.push(String(req.url ?? ''));
      receivedAuthHeader = req.headers.authorization;
      if (req.method === 'POST' && req.url === '/api/v1/tasks') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          receivedBody = JSON.parse(body) as Record<string, unknown>;
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end('{"task_id":"task-xyz","status":"accepted"}');
        });
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          task_id: 'task-xyz',
          status: 'completed',
          result: {
            status: 'completed',
            output: { result: 'ok', evidence: 'go-runtime' },
            metrics: { total_cost_usd: 0.01 },
            git_commit: 'abc123',
            git_push_ok: true,
            files_changed: ['src/index.ts'],
            verification_results: { passed: true, strategy: 'structured_review' },
          },
        }),
      );
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start mock executor server');
    }

    try {
      const config: TaskExecutorConfig = {
        internalWorkerBackend: 'go-runtime',
        runtimeUrl: `http://127.0.0.1:${address.port}/api/v1/tasks`,
        runtimeApiKey: 'runtime-token',
        agentApiKey: 'executor-token',
      };
      const task = {
        id: 'task-xyz',
        role: 'developer',
        type: 'analysis',
        title: 'Analysis task',
        input: { repo: 'enterprise/example' },
      };

      const result = await executeTask(task, config);

      expect(result.success).toBe(true);
      expect(result.output).toMatchObject({ result: 'ok', evidence: 'go-runtime' });
      expect(result.metrics).toMatchObject({ total_cost_usd: 0.01 });
      expect(result.gitInfo).toMatchObject({
        commit_hash: 'abc123',
        git_push_ok: true,
        files_changed: ['src/index.ts'],
      });
      expect(result.verification).toMatchObject({ passed: true, strategy: 'structured_review' });
      expect(receivedAuthHeader).toBe('Bearer runtime-token');
      expect(receivedBody).toMatchObject({
        task_id: 'task-xyz',
        role: 'developer',
        input: { repo: 'enterprise/example' },
      });
      expect(observedUrls).toEqual(['/api/v1/tasks', '/api/v1/tasks/task-xyz']);
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
  });

  it('returns a failure result when the runtime call times out', async () => {
    const config: TaskExecutorConfig = {
      internalWorkerBackend: 'go-runtime',
      runtimeUrl: 'http://192.0.2.1:9999/api/v1/tasks',
      taskTimeoutMs: 50,
    };
    const task = { id: 'task-timeout', type: 'code', title: 'Timeout task' };

    const result = await executeTask(task, config);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
  }, 5000);
});

describe('createBuiltInTaskHandler', () => {
  it('returns a callable function (the task handler)', () => {
    const handler = createBuiltInTaskHandler(minimalConfig, mockRegistration);
    expect(typeof handler).toBe('function');
  });

  it('handler function accepts a task record as input', () => {
    const handler = createBuiltInTaskHandler(minimalConfig, mockRegistration);
    // The handler is a function that takes a task record — verify it is async
    const result = handler({ id: 'task-test', type: 'code', title: 'Test' });
    expect(result).toBeInstanceOf(Promise);
    // Reject gracefully — we don't have a real API to call
    void result.catch(() => undefined);
  });

  it('createBuiltInTaskHandler and executeTask are distinct exported functions', async () => {
    const { createBuiltInTaskHandler: freshHandler, executeTask: freshExecute } = await import(
      '../../src/bootstrap/built-in-worker.js'
    );

    // They are distinct functions — handler composes executeTask + Platform API calls
    expect(freshHandler).not.toBe(freshExecute);
    expect(typeof freshHandler).toBe('function');
    expect(typeof freshExecute).toBe('function');
  });
});

describe('connectBuiltInWorkerWebSocket', () => {
  it('reconnects automatically after the websocket connection drops', async () => {
    const connections: Array<{ auth?: string }> = [];
    const sockets: Array<import('ws').WebSocket> = [];
    const httpServer = createServer();
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (request, socket, head) => {
      if ((request.url ?? '') !== mockRegistration.websocketUrl) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        sockets.push(ws);
        connections.push({ auth: request.headers.authorization });
        ws.send(JSON.stringify({ type: 'connection.ready' }));
      });
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start websocket test server');
    }

    const disconnect = connectBuiltInWorkerWebSocket(
      mockRegistration,
      {
        apiBaseUrl: `http://127.0.0.1:${address.port}`,
        reconnectMinMs: 50,
        reconnectMaxMs: 100,
      },
      async () => undefined,
    );

    try {
      await waitFor(() => connections.length >= 1);
      expect(connections[0]).toMatchObject({ auth: `Bearer ${mockRegistration.workerApiKey}` });

      sockets[0]?.terminate();

      await waitFor(() => connections.length >= 2);
      expect(connections[1]).toMatchObject({ auth: `Bearer ${mockRegistration.workerApiKey}` });
    } finally {
      disconnect();
      await new Promise<void>((resolve) => {
        wss.clients.forEach((client) => client.terminate());
        wss.close(() => {
          httpServer.close(() => resolve());
        });
      });
    }
  });
});

// ---------------------------------------------------------------------------
// FR-750 — checkProhibitedOperations pure helper
// ---------------------------------------------------------------------------

describe('checkProhibitedOperations', () => {
  it('returns undefined when task has no requirements field', () => {
    const result = checkProhibitedOperations(undefined, ['docker-exec', 'bare-metal-exec']);
    expect(result).toBeUndefined();
  });

  it('returns undefined when task requirements array is empty', () => {
    const result = checkProhibitedOperations([], ['docker-exec']);
    expect(result).toBeUndefined();
  });

  it('returns undefined when prohibited operations list is empty', () => {
    const result = checkProhibitedOperations(['docker-exec'], []);
    expect(result).toBeUndefined();
  });

  it('returns undefined when requirements contain only allowed operations', () => {
    const result = checkProhibitedOperations(
      ['llm-api-call', 'text-processing'],
      ['docker-exec', 'bare-metal-exec'],
    );
    expect(result).toBeUndefined();
  });

  it('returns the prohibited operation when task requires docker-exec', () => {
    const result = checkProhibitedOperations(['docker-exec'], ['docker-exec', 'bare-metal-exec']);
    expect(result).toBe('docker-exec');
  });

  it('returns the prohibited operation when task requires bare-metal-exec', () => {
    const result = checkProhibitedOperations(
      ['bare-metal-exec'],
      ['docker-exec', 'bare-metal-exec'],
    );
    expect(result).toBe('bare-metal-exec');
  });

  it('returns the first prohibited operation encountered in requirements', () => {
    const result = checkProhibitedOperations(
      ['llm-api-call', 'host-filesystem-write', 'docker-exec'],
      ['docker-exec', 'host-filesystem-write'],
    );
    // 'host-filesystem-write' appears first in the requirements array
    expect(result).toBe('host-filesystem-write');
  });

  it('ignores non-string entries in requirements', () => {
    const result = checkProhibitedOperations([42, null, 'llm-api-call'], ['docker-exec']);
    expect(result).toBeUndefined();
  });

  it('returns undefined when requirements is not an array (e.g. a string)', () => {
    const result = checkProhibitedOperations('docker-exec', ['docker-exec']);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FR-750 — handler rejects prohibited operations before execution
// ---------------------------------------------------------------------------

describe('createBuiltInTaskHandler deterministic failure mode contract', () => {
  it('fails immediately when task context requests deterministic_impossible mode', async () => {
    const observedPaths: string[] = [];
    let failPayload: Record<string, unknown> | undefined;

    const server = createServer((req, res) => {
      observedPaths.push(req.url ?? '');
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        if ((req.url ?? '').endsWith('/fail')) {
          failPayload = JSON.parse(body) as Record<string, unknown>;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start mock Platform API server');
    }

    try {
      const executorSpy = vi
        .fn<(_: Record<string, unknown>, __: TaskExecutorConfig) => Promise<TaskExecutionResult>>()
        .mockResolvedValue({ output: { unexpected: true }, success: true });

      const handler = createBuiltInTaskHandler(
        {
          ...minimalConfig,
          apiBaseUrl: `http://127.0.0.1:${address.port}`,
        },
        mockRegistration,
        { executeTaskFn: executorSpy },
      );

      await handler({
        id: 'task-ap7',
        type: 'code',
        title: 'AP-7 deterministic impossible task',
        context: {
          failure_mode: 'deterministic_impossible',
        },
      });

      expect(executorSpy).not.toHaveBeenCalled();
      expect(observedPaths).toEqual(['/api/v1/tasks/task-ap7/fail']);
      expect(failPayload).toMatchObject({
        error: {
          code: 'deterministic_impossible_scope',
          failure_mode: 'deterministic_impossible',
          deterministic: true,
        },
      });
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
  });
});

describe('createBuiltInTaskHandler with prohibitedOperations', () => {
  it('does not invoke the task executor when a prohibited operation is required', async () => {
    const configWithProhibitions: BuiltInWorkerConfig = {
      ...minimalConfig,
      prohibitedOperations: ['docker-exec', 'bare-metal-exec'],
    };

    const executorSpy =
      vi.fn<(_: Record<string, unknown>, __: TaskExecutorConfig) => Promise<TaskExecutionResult>>();

    const handler = createBuiltInTaskHandler(configWithProhibitions, mockRegistration, {
      executeTaskFn: executorSpy,
    });

    const forbiddenTask = {
      id: 'task-docker',
      type: 'infra',
      title: 'Run Docker container',
      requirements: ['docker-exec'],
    };

    // The handler will attempt to call the Platform API /fail endpoint.
    // No real API server exists so the network call throws — that is expected.
    await handler(forbiddenTask).catch(() => undefined);

    // Critical assertion: the executor must never be called for a prohibited task.
    expect(executorSpy).not.toHaveBeenCalled();
  });

  it('invokes the task executor when requirements contain no prohibited operations', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start mock Platform API server');
    }

    try {
      const configWithProhibitions: BuiltInWorkerConfig = {
        ...minimalConfig,
        apiBaseUrl: `http://127.0.0.1:${address.port}`,
        prohibitedOperations: ['docker-exec', 'bare-metal-exec'],
      };

      const executorSpy = vi
        .fn<(_: Record<string, unknown>, __: TaskExecutorConfig) => Promise<TaskExecutionResult>>()
        .mockResolvedValue({ output: { result: 'done' }, success: true });

      const handler = createBuiltInTaskHandler(configWithProhibitions, mockRegistration, {
        executeTaskFn: executorSpy,
      });

      const allowedTask = {
        id: 'task-llm',
        type: 'code',
        title: 'Generate code',
        requirements: ['llm-api-call'],
      };

      await handler(allowedTask);

      expect(executorSpy).toHaveBeenCalledOnce();
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
  });

  it('invokes the task executor when no requirements field is present', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start mock Platform API server');
    }

    try {
      const configWithProhibitions: BuiltInWorkerConfig = {
        ...minimalConfig,
        apiBaseUrl: `http://127.0.0.1:${address.port}`,
        prohibitedOperations: ['docker-exec'],
      };

      const executorSpy = vi
        .fn<(_: Record<string, unknown>, __: TaskExecutorConfig) => Promise<TaskExecutionResult>>()
        .mockResolvedValue({ output: {}, success: true });

      const handler = createBuiltInTaskHandler(configWithProhibitions, mockRegistration, {
        executeTaskFn: executorSpy,
      });

      await handler({ id: 'task-no-req', type: 'code', title: 'No requirements' });

      expect(executorSpy).toHaveBeenCalledOnce();
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
  });
});
