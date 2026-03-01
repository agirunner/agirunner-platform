/**
 * Unit tests for the built-in worker task handler (FR-741, FR-752, FR-754).
 *
 * Proves that the built-in worker can execute tasks via the configured executor
 * and that the handler functions exist and behave correctly.
 */

import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

import {
  executeTask,
  createBuiltInTaskHandler,
  checkProhibitedOperations,
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
};

const minimalConfig: BuiltInWorkerConfig = {
  apiBaseUrl: 'http://localhost:8080',
  adminApiKey: 'ab_admin_deftest',
  capabilities: ['general'],
  name: 'test-built-in-worker',
  heartbeatIntervalSeconds: 30,
};

describe('executeTask', () => {
  it('returns success output when no agentApiUrl is configured', async () => {
    const config: TaskExecutorConfig = {};
    const task = { id: 'task-abc', type: 'code', title: 'Test task' };

    const result = await executeTask(task, config);

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ task_id: 'task-abc', handled_by: 'built-in-worker' });
    expect(result.error).toBeUndefined();
  });

  it('includes the task_id in the output envelope when no agent URL is configured', async () => {
    const config: TaskExecutorConfig = {};
    const task = { id: 'task-xyz', type: 'analysis', title: 'Analysis task' };

    const result = await executeTask(task, config);

    expect(result.success).toBe(true);
    expect(result.output.task_id).toBe('task-xyz');
    expect(result.output.status).toBe('completed');
  });

  it('includes handled_by field to identify built-in worker execution', async () => {
    const config: TaskExecutorConfig = {};
    const task = { id: 'task-id-99', type: 'docs', title: 'Docs task' };

    const result = await executeTask(task, config);

    expect(result.output.handled_by).toBe('built-in-worker');
  });

  it('returns a failure result when the agent API call times out', async () => {
    const config: TaskExecutorConfig = {
      agentApiUrl: 'http://192.0.2.1:9999/execute', // non-routable IP — will time out fast
      taskTimeoutMs: 50, // very short timeout to fail fast in tests
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
    const result = checkProhibitedOperations(['llm-api-call', 'text-processing'], ['docker-exec', 'bare-metal-exec']);
    expect(result).toBeUndefined();
  });

  it('returns the prohibited operation when task requires docker-exec', () => {
    const result = checkProhibitedOperations(['docker-exec'], ['docker-exec', 'bare-metal-exec']);
    expect(result).toBe('docker-exec');
  });

  it('returns the prohibited operation when task requires bare-metal-exec', () => {
    const result = checkProhibitedOperations(['bare-metal-exec'], ['docker-exec', 'bare-metal-exec']);
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

describe('createBuiltInTaskHandler with prohibitedOperations', () => {
  it('does not invoke the task executor when a prohibited operation is required', async () => {
    const configWithProhibitions: BuiltInWorkerConfig = {
      ...minimalConfig,
      prohibitedOperations: ['docker-exec', 'bare-metal-exec'],
    };

    const executorSpy = vi.fn<(_: Record<string, unknown>, __: TaskExecutorConfig) => Promise<TaskExecutionResult>>();

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

      const executorSpy = vi.fn<(_: Record<string, unknown>, __: TaskExecutorConfig) => Promise<TaskExecutionResult>>()
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
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }));
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

      const executorSpy = vi.fn<(_: Record<string, unknown>, __: TaskExecutorConfig) => Promise<TaskExecutionResult>>()
        .mockResolvedValue({ output: {}, success: true });

      const handler = createBuiltInTaskHandler(configWithProhibitions, mockRegistration, {
        executeTaskFn: executorSpy,
      });

      await handler({ id: 'task-no-req', type: 'code', title: 'No requirements' });

      expect(executorSpy).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }));
    }
  });
});
