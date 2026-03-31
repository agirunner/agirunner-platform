import { describe, expect, it, vi } from 'vitest';
import { TaskLifecycleService } from '../../../src/services/task-lifecycle-service.js';
type TaskLifecycleDependencies = ConstructorParameters<typeof TaskLifecycleService>[0];
describe('TaskLifecycleService secret sanitization on completion/failure write path', () => {
  const REDACTED = 'redacted://secret';

  const agentIdentity = {
    id: 'agent-key',
    tenantId: 'tenant-1',
    scope: 'agent' as const,
    ownerType: 'agent',
    ownerId: 'agent-1',
    keyPrefix: 'ak',
  };

  function buildCapturingService(
    initialTaskOverrides: Record<string, unknown> = {},
    returnedRowOverrides: Record<string, unknown> = {},
  ) {
    const capturedUpdates: { sql: string; values: unknown[] }[] = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks SET')) {
          capturedUpdates.push({ sql, values: (values ?? []) as unknown[] });
          return {
            rowCount: 1,
            rows: [{
              id: 'task-sanitize',
              state: 'completed',
              workflow_id: null,
              assigned_agent_id: null,
              assigned_worker_id: null,
              output: {},
              metrics: {},
              git_info: {},
              metadata: {},
              ...returnedRowOverrides,
            }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-sanitize',
        state: 'in_progress',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        role_config: {},
        metadata: {},
        retry_count: 0,
        ...initialTaskOverrides,
      }),
      toTaskResponse: (task) => task,
    });

    return { service, capturedUpdates };
  }

  it('completeTask redacts secret-like values from output, metrics, git_info, and verification', async () => {
    const { service, capturedUpdates } = buildCapturingService();

    await service.completeTask(agentIdentity, 'task-sanitize', {
      output: { result: 'ok', api_key: 'sk-live-abc123' },
      metrics: { duration: 10, authorization: 'Bearer my-secret-token' },
      git_info: { commit: 'abc123', token: 'ghp_supersecret' },
      verification: { passed: true, secret: 'hunter2' },
    });

    expect(capturedUpdates).toHaveLength(1);
    const { values } = capturedUpdates[0]!;

    // output — api_key value must be redacted
    const outputParam = values.find(
      (v) => typeof v === 'object' && v !== null && 'result' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(outputParam).toBeDefined();
    expect(outputParam.result).toBe('ok');
    expect(outputParam.api_key).toBe(REDACTED);

    // metrics — authorization value must be redacted
    const metricsParam = values.find(
      (v) => typeof v === 'object' && v !== null && 'duration' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(metricsParam).toBeDefined();
    expect(metricsParam.duration).toBe(10);
    expect(metricsParam.authorization).toBe(REDACTED);

    // git_info — token value must be redacted
    const gitInfoParam = values.find(
      (v) => typeof v === 'object' && v !== null && 'commit' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(gitInfoParam).toBeDefined();
    expect(gitInfoParam.commit).toBe('abc123');
    expect(gitInfoParam.token).toBe(REDACTED);

    // verification — stored in metadata patch, secret must be redacted
    const metadataPatch = values.find(
      (v) => typeof v === 'object' && v !== null && 'verification' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(metadataPatch).toBeDefined();
    const verification = metadataPatch.verification as Record<string, unknown>;
    expect(verification.passed).toBe(true);
    expect(verification.secret).toBe(REDACTED);
  });

  it('failTask redacts secret-like values from error, metrics, and git_info', async () => {
    const { service, capturedUpdates } = buildCapturingService({}, { state: 'failed' });

    await service.failTask(agentIdentity, 'task-sanitize', {
      error: { category: 'unknown', message: 'crashed', password: 'oops-plaintext' },
      metrics: { duration: 5, credential: 'secret-cred-value' },
      git_info: { branch: 'main', private_key: 'ssh-rsa AAAA' },
    });

    expect(capturedUpdates).toHaveLength(1);
    const { values } = capturedUpdates[0]!;

    // error — password value must be redacted
    const errorParam = values.find(
      (v) => typeof v === 'object' && v !== null && 'category' in (v as Record<string, unknown>) && 'password' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(errorParam).toBeDefined();
    expect(errorParam.category).toBe('unknown');
    expect(errorParam.message).toBe('crashed');
    expect(errorParam.password).toBe(REDACTED);

    // metrics — credential value must be redacted
    const metricsParam = values.find(
      (v) => typeof v === 'object' && v !== null && 'duration' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(metricsParam).toBeDefined();
    expect(metricsParam.duration).toBe(5);
    expect(metricsParam.credential).toBe(REDACTED);

    // git_info — private_key value must be redacted
    const gitInfoParam = values.find(
      (v) => typeof v === 'object' && v !== null && 'branch' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(gitInfoParam).toBeDefined();
    expect(gitInfoParam.branch).toBe('main');
    expect(gitInfoParam.private_key).toBe(REDACTED);
  });

  it('failTask redacts retry_last_error in metadata patch on auto-retry', async () => {
    const { service, capturedUpdates } = buildCapturingService(
      {
        metadata: {
          lifecycle_policy: {
            retry_policy: {
              max_attempts: 3,
              retryable_categories: ['timeout'],
              backoff_strategy: 'fixed',
              initial_backoff_seconds: 1,
            },
          },
        },
      },
      { state: 'pending' },
    );

    await service.failTask(agentIdentity, 'task-sanitize', {
      error: { category: 'timeout', message: 'timed out', recoverable: true, api_key: 'sk-leaked' },
    });

    expect(capturedUpdates).toHaveLength(1);
    const { values } = capturedUpdates[0]!;

    // metadata patch contains retry_last_error — api_key must be redacted
    const metadataPatch = values.find(
      (v) => typeof v === 'object' && v !== null && 'retry_last_error' in (v as Record<string, unknown>),
    ) as Record<string, unknown>;
    expect(metadataPatch).toBeDefined();
    const retryError = metadataPatch.retry_last_error as Record<string, unknown>;
    expect(retryError.category).toBe('timeout');
    expect(retryError.message).toBe('timed out');
    expect(retryError.api_key).toBe(REDACTED);
  });

  it('completeTask replay detection still works after sanitization', async () => {
    const storedOutput = { result: 'ok', api_key: REDACTED };
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-replay-sanitized',
        state: 'completed',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        output: storedOutput,
        role_config: {},
      }),
      toTaskResponse: (task) => task,
    });

    // Replay with the same secret material — the sanitized form should match
    const result = await service.completeTask(agentIdentity, 'task-replay-sanitized', {
      output: { result: 'ok', api_key: 'sk-live-abc123' },
    });

    expect(result.state).toBe('completed');
    // Should return the existing task without any UPDATE query
    expect(client.query).not.toHaveBeenCalled();
  });

  it('failTask replay detection still works after sanitization', async () => {
    const storedError = { category: 'timeout', message: 'timed out', api_key: REDACTED };
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const service = new TaskLifecycleService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn() } as never,
      workflowStateService: { recomputeWorkflowState: vi.fn() } as never,
      defaultTaskTimeoutMinutes: 30,
      loadTaskOrThrow: vi.fn().mockResolvedValue({
        id: 'task-fail-replay-sanitized',
        state: 'failed',
        workflow_id: null,
        assigned_agent_id: 'agent-1',
        assigned_worker_id: null,
        error: storedError,
        metadata: {},
      }),
      toTaskResponse: (task) => task,
    });

    // Replay with the same secret material
    const result = await service.failTask(agentIdentity, 'task-fail-replay-sanitized', {
      error: { category: 'timeout', message: 'timed out', api_key: 'sk-leaked' },
    });

    expect(result.state).toBe('failed');
    expect(client.query).not.toHaveBeenCalled();
  });
});
