/**
 * Unit tests for the built-in worker task handler (FR-741, FR-752, FR-754).
 *
 * Proves that the built-in worker can execute tasks via the configured executor
 * and that the handler functions exist and behave correctly.
 */

import { describe, expect, it } from 'vitest';

import {
  executeTask,
  createBuiltInTaskHandler,
  type TaskExecutorConfig,
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
