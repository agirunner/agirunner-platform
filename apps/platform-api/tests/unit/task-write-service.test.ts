import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readRequiredPositiveIntegerRuntimeDefaultMock } = vi.hoisted(() => ({
  readRequiredPositiveIntegerRuntimeDefaultMock: vi.fn(async () => 30),
}));

vi.mock('../../src/services/runtime-default-values.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/services/runtime-default-values.js')>(
      '../../src/services/runtime-default-values.js',
    );
  return {
    ...actual,
    readRequiredPositiveIntegerRuntimeDefault: readRequiredPositiveIntegerRuntimeDefaultMock,
  };
});

import { ConflictError } from '../../src/errors/domain-errors.js';
import { TaskWriteService } from '../../src/services/task-write-service.js';

function isLinkedWorkItemLookup(sql: string) {
  return sql.includes('FROM workflow_work_items wi')
    || sql.includes('SELECT workflow_id, stage_name FROM workflow_work_items');
}

function isPlaybookDefinitionLookup(sql: string) {
  return sql.includes('JOIN playbooks pb');
}

describe('TaskWriteService', () => {
  beforeEach(() => {
    readRequiredPositiveIntegerRuntimeDefaultMock.mockReset();
    readRequiredPositiveIntegerRuntimeDefaultMock.mockResolvedValue(30);
  });

  it('uses the runtime default task timeout when input omits one', async () => {
    let insertedTimeoutMinutes: number | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedTimeoutMinutes = (values?.[21] as number) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              timeout_minutes: insertedTimeoutMinutes,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {} as never,
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    readRequiredPositiveIntegerRuntimeDefaultMock.mockResolvedValueOnce(45);

    await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Implement hello world',
      },
    );

    expect(insertedTimeoutMinutes).toBe(45);
  });

  it('fails fast when the runtime default task timeout is missing', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('INSERT INTO tasks')) {
          throw new Error('task insert should not run without a default timeout');
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {} as never,
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    readRequiredPositiveIntegerRuntimeDefaultMock.mockRejectedValueOnce(
      new Error('Missing runtime default "tasks.default_timeout_minutes"'),
    );

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Implement hello world',
        },
      ),
    ).rejects.toThrow('Missing runtime default "tasks.default_timeout_minutes"');
  });

  it('derives output review from playbook rules instead of trusting reviewer task input', async () => {
    let insertedRequiresOutputReview: boolean | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('JOIN playbooks pb')) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                process_instructions: 'Developer implements, reviewer reviews, QA validates.',
                roles: ['developer', 'reviewer', 'qa'],
                review_rules: [
                  {
                    from_role: 'developer',
                    reviewed_by: 'reviewer',
                    required: true,
                  },
                ],
                approval_rules: [],
                handoff_rules: [
                  {
                    from_role: 'reviewer',
                    to_role: 'qa',
                    required: true,
                  },
                ],
                checkpoints: [],
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                  entry_column_id: 'planned',
                },
                lifecycle: 'planned',
              },
            }],
          };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('work_item_id = $3') &&
          sql.includes('role = $4') &&
          sql.includes('state = ANY($5::task_state[])')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedRequiresOutputReview = (values?.[11] as boolean) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'review-task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              requires_output_review: insertedRequiresOutputReview,
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Review implementation',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-review-normalized',
        role: 'reviewer',
        type: 'review',
        requires_output_review: true,
      },
    );

    expect(insertedRequiresOutputReview).toBe(false);
  });

  it('applies playbook task loop defaults when workflow tasks do not override them', async () => {
    let insertedMaxIterations: number | null = null;
    let insertedLLMMaxRetries: number | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return {
            rowCount: 1,
            rows: [{
              repository_url: null,
              settings: {},
              git_branch: null,
              parameters: {},
            }],
          };
        }
        if (sql.includes('JOIN playbooks pb')) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                process_instructions: 'Developer implements and reviewer checks it.',
                roles: ['developer', 'reviewer'],
                review_rules: [],
                approval_rules: [],
                handoff_rules: [],
                checkpoints: [],
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                  entry_column_id: 'planned',
                },
                lifecycle: 'planned',
                orchestrator: {
                  max_iterations: 120,
                  llm_max_retries: 7,
                },
              },
            }],
          };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('work_item_id = $3') &&
          sql.includes('role = $4') &&
          sql.includes('state = ANY($5::task_state[])')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedMaxIterations = (values?.[26] as number | null) ?? null;
          insertedLLMMaxRetries = (values?.[27] as number | null) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-loop-defaults',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              max_iterations: insertedMaxIterations,
              llm_max_retries: insertedLLMMaxRetries,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const created = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Implement feature',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-loop-defaults',
        role: 'developer',
        type: 'code',
      },
    );

    expect(insertedMaxIterations).toBe(120);
    expect(insertedLLMMaxRetries).toBe(7);
    expect(created.max_iterations).toBe(120);
    expect(created.llm_max_retries).toBe(7);
  });

  it('defaults workflow task execution context from the workflow repository settings', async () => {
    let insertedEnvironment: Record<string, unknown> | null = null;
    let insertedBindings: string | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return {
            rowCount: 1,
            rows: [{
              repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              settings: {
                default_branch: 'main',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.com',
                credentials: {
                  git_token: 'secret:GITHUB_PAT',
                },
              },
              git_branch: null,
              parameters: {
                feature_branch: 'smoke/test/fix',
              },
            }],
          };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('work_item_id = $3') &&
          sql.includes('role = $4') &&
          sql.includes('state = ANY($5::task_state[])')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedEnvironment = (values?.[16] as Record<string, unknown>) ?? null;
          insertedBindings = (values?.[17] as string) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-repo-defaults',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              environment: insertedEnvironment,
              resource_bindings: insertedBindings,
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Repo-backed developer task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-repo-defaults',
        role: 'developer',
      },
    );

    expect(insertedEnvironment).toEqual(
      expect.objectContaining({
        repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
        branch: 'smoke/test/fix',
        base_branch: 'main',
        git_user_name: 'Smoke Bot',
        git_user_email: 'smoke@example.com',
        template: 'execution-workspace',
      }),
    );
    expect(JSON.parse(insertedBindings ?? '[]')).toEqual([
      {
        type: 'git_repository',
        repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
        credentials: { token: 'secret:GITHUB_PAT' },
      },
    ]);
  });

  it('treats branch-only workflow parameters as feature branch work while keeping the project default as base branch', async () => {
    let insertedEnvironment: Record<string, unknown> | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return {
            rowCount: 1,
            rows: [{
              repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              settings: {
                default_branch: 'main',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.com',
                credentials: {
                  git_token: 'secret:GITHUB_PAT',
                },
              },
              git_branch: null,
              parameters: {
                branch: 'feature/hello-world',
              },
            }],
          };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('work_item_id = $3') &&
          sql.includes('role = $4') &&
          sql.includes('state = ANY($5::task_state[])')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedEnvironment = (values?.[16] as Record<string, unknown>) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-branch-only',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              environment: insertedEnvironment,
              resource_bindings: values?.[17] ?? null,
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Repo-backed developer task from branch-only workflow input',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-branch-only-repo-defaults',
        role: 'developer',
      },
    );

    expect(insertedEnvironment).toEqual(
      expect.objectContaining({
        repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
        branch: 'feature/hello-world',
        base_branch: 'main',
        git_user_name: 'Smoke Bot',
        git_user_email: 'smoke@example.com',
        template: 'execution-workspace',
      }),
    );
  });

  it('replaces redacted git binding placeholders with workflow repository credentials on new tasks', async () => {
    let insertedBindings: string | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'verification' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return {
            rowCount: 1,
            rows: [{
              repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              settings: {
                default_branch: 'main',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.com',
                credentials: {
                  git_token: 'secret:GITHUB_PAT',
                },
              },
              git_branch: null,
              parameters: {
                feature_branch: 'smoke/test/fix',
              },
            }],
          };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('work_item_id = $3') &&
          sql.includes('role = $4') &&
          sql.includes('state = ANY($5::task_state[])')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedBindings = (values?.[17] as string | null) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-redacted-binding',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              resource_bindings: insertedBindings,
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'QA rerun',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-redacted-binding',
        role: 'qa',
        resource_bindings: [{
          type: 'git_repository',
          repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
          credentials: {
            token: 'redacted://task-secret',
          },
        }],
      },
    );

    expect(JSON.parse(insertedBindings ?? '[]')).toEqual([
      {
        type: 'git_repository',
        repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
        credentials: {
          token: 'secret:GITHUB_PAT',
        },
      },
    ]);
  });

  it('does not override an explicit repository task environment template or image', async () => {
    let insertedEnvironment: Record<string, unknown> | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return {
            rowCount: 1,
            rows: [{
              repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              settings: {
                default_branch: 'main',
                credentials: {
                  git_token: 'secret:GITHUB_PAT',
                },
              },
              git_branch: null,
              parameters: {},
            }],
          };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('work_item_id = $3') &&
          sql.includes('role = $4') &&
          sql.includes('state = ANY($5::task_state[])')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedEnvironment = (values?.[16] as Record<string, unknown>) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-explicit-template',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              environment: insertedEnvironment,
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Explicit env template task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-explicit-template',
        role: 'developer',
        environment: {
          template: 'python',
          image: 'custom:latest',
        },
      },
    );

    expect(insertedEnvironment).toEqual(
      expect.objectContaining({
        template: 'python',
        image: 'custom:latest',
      }),
    );
  });

  it('defaults workflow task capabilities from the resolved role definition', async () => {
    let insertedCapabilities: string[] | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('work_item_id = $3') &&
          sql.includes('role = $4') &&
          sql.includes('state = ANY($5::task_state[])')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedCapabilities = (values?.[14] as string[]) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-role-default',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              request_id: 'request-role-default',
              capabilities_required: insertedCapabilities,
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
      resolveRoleCapabilities: vi.fn(async () => ['coding', 'testing', 'documentation']),
    });

    const result = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Repo-backed developer task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-role-default',
        role: 'developer',
      },
    );

    expect(insertedCapabilities).toEqual(['coding', 'testing', 'documentation']);
    expect(result.capabilities_required).toEqual(['coding', 'testing', 'documentation']);
  });

  it('rejects workflow specialist tasks that are not linked to a work item', async () => {
    const service = new TaskWriteService({
      pool: {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
            return { rowCount: 0, rows: [] };
          }
          if (isPlaybookDefinitionLookup(sql)) {
            return { rowCount: 0, rows: [] };
          }
          throw new Error(`unexpected query: ${sql}`);
        }),
      } as never,
      eventService: { emit: vi.fn() } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Invalid workflow task',
          workflow_id: 'workflow-1',
          role: 'developer',
        },
      ),
    ).rejects.toThrow(/must be linked to a work item/i);
  });

  it('updates task input for non-terminal tasks and emits a task.input_updated event', async () => {
    const emit = vi.fn(async () => undefined);
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('UPDATE tasks') && sql.includes('SET input = $3::jsonb')) {
          expect(values).toEqual(['tenant-1', 'task-1', { scope: 'narrowed' }]);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              stage_name: 'implementation',
              input: { scope: 'narrowed' },
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(async () => ({
        id: 'task-1',
        state: 'ready',
        input: { scope: 'broad' },
      })),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const result = await service.updateTaskInput('tenant-1', 'task-1', { scope: 'narrowed' });

    expect(result.input).toEqual({ scope: 'narrowed' });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        type: 'task.input_updated',
        entityType: 'task',
        entityId: 'task-1',
      }),
      undefined,
    );
  });

  it('defaults workflow task repository execution context from workflow parameters', async () => {
    let insertedEnvironment: Record<string, unknown> | null = null;
    let insertedBindings: string | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return {
            rowCount: 1,
            rows: [{
              repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              settings: { default_branch: 'main' },
              git_branch: null,
              parameters: {
                feature_branch: 'smoke/test-branch',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.test',
                git_token_secret_ref: 'secret:GITHUB_PAT',
              },
            }],
          };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('work_item_id = $3') &&
          sql.includes('role = $4') &&
          sql.includes('state = ANY($5::task_state[])')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedEnvironment = (values?.[16] as Record<string, unknown>) ?? null;
          insertedBindings = (values?.[17] as string | null) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-workflow-defaults',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              environment: insertedEnvironment,
              resource_bindings: insertedBindings,
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const result = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Repo-backed developer task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-workflow-defaults',
        role: 'developer',
      },
    );

    expect(insertedEnvironment).toEqual({
      repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
      branch: 'smoke/test-branch',
      base_branch: 'main',
      git_user_name: 'Smoke Bot',
      git_user_email: 'smoke@example.test',
      template: 'execution-workspace',
    });
    expect(JSON.parse(insertedBindings ?? '[]')).toEqual([
      {
        type: 'git_repository',
        repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
        credentials: {
          token: 'secret:GITHUB_PAT',
        },
      },
    ]);
    expect(result.environment).toEqual(insertedEnvironment);
  });

  it('returns the existing task when request_id is replayed in the same workflow scope', async () => {
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('workflow_id = $2') &&
          sql.includes('request_id = $3') &&
          values?.[1] === 'workflow-1' &&
          values?.[2] === 'request-1'
        ) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              request_id: 'request-1',
              role: null,
              stage_name: 'implementation',
              depends_on: [],
              requires_approval: false,
              requires_output_review: false,
              context: {},
              role_config: null,
              environment: null,
              resource_bindings: [],
              activation_id: null,
              is_orchestrator_task: false,
              token_budget: null,
              cost_cap_usd: null,
              auto_retry: false,
              max_retries: 0,
              metadata: {},
            }],
          };
        }
        throw new Error('unexpected query');
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn() } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const result = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Existing task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-1',
      },
    );

    expect(result.id).toBe('task-1');
    expect(pool.query).toHaveBeenCalledTimes(5);
  });

  it('returns the existing active task when the same work item and role already have in-flight work', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'requirements' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('workflow_id = $2') &&
          sql.includes('request_id = $3')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('work_item_id = $3') &&
          sql.includes('role = $4') &&
          sql.includes('state = ANY($5::task_state[])')
        ) {
          expect(values).toEqual([
            'tenant-1',
            'workflow-1',
            'work-item-1',
            'product-manager',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_review', 'escalated'],
          ]);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-existing-active',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              request_id: 'request-existing-active',
              role: 'product-manager',
              stage_name: 'requirements',
              state: 'in_progress',
              metadata: {},
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: eventService as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const result = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Duplicate requirements clarification task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-new-active',
        role: 'product-manager',
      },
    );

    expect(result.id).toBe('task-existing-active');
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('preserves explicit specialist token budgets for insert and request replay matching', async () => {
    let insertedTokenBudget: number | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'design' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('workflow_id = $2') &&
          sql.includes('request_id = $3')
        ) {
          if (insertedTokenBudget === null) {
            return { rowCount: 0, rows: [] };
          }
          return {
            rowCount: 1,
            rows: [{
              id: 'task-budget-floor',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              request_id: 'request-budget-floor',
              role: 'architect',
              stage_name: 'design',
              depends_on: [],
              requires_approval: false,
              requires_output_review: false,
              context: {},
              role_config: null,
              environment: null,
              resource_bindings: [],
              activation_id: null,
              is_orchestrator_task: false,
              token_budget: insertedTokenBudget,
              cost_cap_usd: null,
              auto_retry: false,
              max_retries: 0,
              metadata: {},
            }],
              };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('work_item_id = $3') &&
          sql.includes('role = $4') &&
          sql.includes('state = ANY($5::task_state[])')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedTokenBudget = (values?.[22] as number) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-budget-floor',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              request_id: 'request-budget-floor',
              role: 'architect',
              stage_name: 'design',
              token_budget: insertedTokenBudget,
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const created = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Architect task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        role: 'architect',
        request_id: 'request-budget-floor',
        token_budget: 6000,
      },
    );

    const replayed = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Architect task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        role: 'architect',
        request_id: 'request-budget-floor',
        token_budget: 6000,
      },
    );

    expect(insertedTokenBudget).toBe(6000);
    expect(created.token_budget).toBe(6000);
    expect(replayed.id).toBe('task-budget-floor');
    expect(replayed.token_budget).toBe(6000);
  });

  it('does not reuse a request_id from a different workflow', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-2', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-2',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-2',
              request_id: 'request-1',
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const result = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'New task',
        workflow_id: 'workflow-2',
        work_item_id: 'work-item-2',
        request_id: 'request-1',
      },
    );

    expect(result.id).toBe('task-2');
    expect(pool.query).toHaveBeenCalledTimes(6);
  });

  it('loads the existing task when insert races on request_id', async () => {
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('workflow_id = $2') &&
          sql.includes('request_id = $3') &&
          values?.[1] === 'workflow-1' &&
          values?.[2] === 'request-1'
        ) {
          return pool.query.mock.calls.length === 1
            ? { rowCount: 0, rows: [] }
            : {
                rowCount: 1,
                rows: [{
                  id: 'task-raced',
                  tenant_id: 'tenant-1',
                  workflow_id: 'workflow-1',
                  work_item_id: 'work-item-1',
                  request_id: 'request-1',
                  role: null,
                  stage_name: 'implementation',
                  depends_on: [],
                  requires_approval: false,
                  requires_output_review: false,
                  context: {},
                  role_config: null,
                  environment: null,
                  resource_bindings: [],
                  activation_id: null,
                  is_orchestrator_task: false,
                  token_budget: null,
                  cost_cap_usd: null,
                  auto_retry: false,
                  max_retries: 0,
                  metadata: {},
                }],
              };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          return { rowCount: 0, rows: [] };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: eventService as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const result = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Raced task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-1',
      },
    );

    expect(result.id).toBe('task-raced');
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('rejects a request_id replay when the existing task does not match the requested create shape', async () => {
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks') &&
          sql.includes('workflow_id = $2') &&
          sql.includes('request_id = $3') &&
          values?.[1] === 'workflow-1' &&
          values?.[2] === 'request-1'
        ) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              request_id: 'request-1',
              role: 'reviewer',
              stage_name: 'implementation',
              depends_on: [],
              requires_approval: false,
              requires_output_review: false,
              context: {},
              role_config: null,
              environment: null,
              resource_bindings: [],
              activation_id: null,
              is_orchestrator_task: false,
              token_budget: null,
              cost_cap_usd: null,
              auto_retry: false,
              max_retries: 0,
              metadata: {},
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn() } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Existing task',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          request_id: 'request-1',
          role: 'developer',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects plaintext secret-bearing fields in persisted task payloads', async () => {
    const service = new TaskWriteService({
      pool: { query: vi.fn() } as never,
      eventService: { emit: vi.fn() } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Secret task',
          input: {
            credentials: {
              git_token: 'ghp_plaintext_secret',
            },
          },
        },
      ),
    ).rejects.toThrow(/secret-bearing fields/i);
  });

  it('queues approval-required tasks when playbook parallelism capacity is full', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-approval-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              state: 'pending',
              requires_approval: true,
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const parallelismService = {
      shouldQueueForCapacity: vi.fn(async () => true),
    };
    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: parallelismService as never,
    });

    const result = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Approval gated task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        requires_approval: true,
      },
    );

    expect(parallelismService.shouldQueueForCapacity).toHaveBeenCalledWith('tenant-1', {
      workflowId: 'workflow-1',
      workItemId: 'work-item-1',
      isOrchestratorTask: false,
      currentState: null,
    });
    expect(result.state).toBe('pending');
  });

  it('keeps approval-required tasks in awaiting_approval when capacity is available', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'implementation' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN projects p')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-approval-2',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              state: 'awaiting_approval',
              requires_approval: true,
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    const result = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Approval gated task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        requires_approval: true,
      },
    );

    expect(result.state).toBe('awaiting_approval');
  });

  it('rejects creating a planned-workflow task once the linked stage gate is already approved', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('LEFT JOIN workflow_stages ws')) {
          return {
            rowCount: 1,
            rows: [{
              workflow_id: 'workflow-1',
              stage_name: 'requirements',
              workflow_lifecycle: 'planned',
              stage_status: 'awaiting_gate',
              stage_gate_status: 'approved',
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new TaskWriteService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: { TASK_DEFAULT_TIMEOUT_MINUTES: 30 },
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Late requirements reroute',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          request_id: 'late-reroute-1',
          role: 'product-manager',
          stage_name: 'requirements',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
