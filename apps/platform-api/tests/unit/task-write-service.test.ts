import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readRequiredPositiveIntegerRuntimeDefaultMock } = vi.hoisted(() => ({
  readRequiredPositiveIntegerRuntimeDefaultMock:
    vi.fn<(db: unknown, tenantId: string, key: string) => Promise<number>>(),
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

import { ConflictError, ValidationError } from '../../src/errors/domain-errors.js';
import { TaskWriteService } from '../../src/services/task-write-service.js';

const DEFAULT_RUNTIME_DEFAULTS: Record<string, number> = {
  'tasks.default_timeout_minutes': 30,
  'agent.max_iterations': 500,
  'agent.llm_max_retries': 5,
};

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
    readRequiredPositiveIntegerRuntimeDefaultMock.mockImplementation(async (_db, _tenantId, key: string) => {
      const value = DEFAULT_RUNTIME_DEFAULTS[key];
      if (value == null) {
        throw new Error(`unexpected runtime default lookup: ${key}`);
      }
      return value;
    });
  });

  it('uses the runtime default task timeout when input omits one', async () => {
    let insertedTimeoutMinutes: number | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedTimeoutMinutes = (values?.[20] as number) ?? null;
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

    readRequiredPositiveIntegerRuntimeDefaultMock.mockImplementation(async (_db, _tenantId, key: string) => {
      if (key === 'tasks.default_timeout_minutes') {
        return 45;
      }
      const value = DEFAULT_RUNTIME_DEFAULTS[key];
      if (value == null) {
        throw new Error(`unexpected runtime default lookup: ${key}`);
      }
      return value;
    });

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

  it('fails fast when the runtime default max iterations is missing', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('INSERT INTO tasks')) {
          throw new Error('task insert should not run without a max iteration default');
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
      config: {} as never,
      hasOrchestratorPermission: vi.fn(async () => false),
      subtaskPermission: 'create_subtasks',
      loadTaskOrThrow: vi.fn(),
      toTaskResponse: (task) => task,
      parallelismService: {
        shouldQueueForCapacity: vi.fn(async () => false),
      } as never,
    });

    readRequiredPositiveIntegerRuntimeDefaultMock.mockImplementation(async (_db, _tenantId, key: string) => {
      if (key === 'agent.max_iterations') {
        throw new Error('Missing runtime default "agent.max_iterations"');
      }
      const value = DEFAULT_RUNTIME_DEFAULTS[key];
      if (value == null) {
        throw new Error(`unexpected runtime default lookup: ${key}`);
      }
      return value;
    });

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
    ).rejects.toThrow('Missing runtime default "agent.max_iterations"');
  });

  it('derives output assessment from playbook rules instead of trusting reviewer task input', async () => {
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('JOIN playbooks pb')) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                process_instructions: 'Developer implements, reviewer reviews, QA validates.',
                roles: ['developer', 'reviewer', 'qa'],
                assessment_rules: [
                  {
                    subject_role: 'developer',
                    assessed_by: 'reviewer',
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
              requires_assessment: insertedRequiresOutputReview,
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
        type: 'assessment',
        requires_assessment: true,
      },
    );

    expect(insertedRequiresOutputReview).toBe(false);
  });

  it('only requires output assessment on the checkpoint named by the playbook review rule', async () => {
    const insertedRequiresOutputReview: boolean[] = [];
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (isLinkedWorkItemLookup(sql)) {
          const workItemId = values?.[1];
          if (workItemId === 'reproduce-item') {
            return {
              rowCount: 1,
              rows: [{ workflow_id: 'workflow-1', stage_name: 'reproduce' }],
            };
          }
          if (workItemId === 'test-item') {
            return {
              rowCount: 1,
              rows: [{ workflow_id: 'workflow-1', stage_name: 'test' }],
            };
          }
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
          return { rowCount: 0, rows: [] };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                roles: ['live-test-developer', 'live-test-qa', 'live-test-reviewer'],
                assessment_rules: [
                  {
                    subject_role: 'live-test-developer',
                    assessed_by: 'live-test-qa',
                    checkpoint: 'test',
                    required: true,
                  },
                ],
                approval_rules: [],
                handoff_rules: [],
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
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
          insertedRequiresOutputReview.push(Boolean(values?.[11]));
          return {
            rowCount: 1,
            rows: [{
              id: `task-${insertedRequiresOutputReview.length}`,
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: values?.[2],
              requires_assessment: Boolean(values?.[11]),
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

    await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Reproduce punctuation bug',
        workflow_id: 'workflow-1',
        work_item_id: 'reproduce-item',
        request_id: 'request-reproduce-stage',
        role: 'live-test-developer',
      },
    );

    await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'QA verify punctuation fix',
        workflow_id: 'workflow-1',
        work_item_id: 'test-item',
        request_id: 'request-test-stage',
        role: 'live-test-developer',
      },
    );

    expect(insertedRequiresOutputReview).toEqual([false, true]);
  });

  it('rejects out-of-sequence task creation when work item continuity expects a different actor', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{
              workflow_id: 'workflow-1',
              stage_name: 'test',
              workflow_lifecycle: 'planned',
              stage_status: 'active',
              stage_gate_status: 'not_requested',
              owner_role: 'live-test-qa',
              next_expected_actor: 'live-test-reviewer',
              next_expected_action: 'handoff',
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

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'agent',
          keyPrefix: 'agent-key',
        } as never,
        {
          title: 'QA verify named greeting punctuation fix',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          request_id: 'request-out-of-sequence-role',
          role: 'live-test-qa',
          stage_name: 'test',
          type: 'test',
        },
      ),
    ).rejects.toThrow(ConflictError);
  });

  it('allows child assessment work items to dispatch a different assessment role when the stage permits it', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{
              workflow_id: 'workflow-1',
              stage_name: 'review',
              workflow_lifecycle: 'planned',
              stage_status: 'active',
              stage_gate_status: 'not_requested',
              parent_work_item_id: 'implementation-item',
              owner_role: 'implementation-engineer',
              next_expected_actor: null,
              next_expected_action: 'assess',
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                process_instructions: 'Implementation is assessed before release.',
                roles: ['implementation-engineer', 'acceptance-gate-assessor'],
                assessment_rules: [],
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
                stages: [
                  {
                    name: 'review',
                    goal: 'Assess the implementation output',
                    involves: ['implementation-engineer', 'acceptance-gate-assessor'],
                  },
                ],
              },
            }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
        if (
          sql.includes('FROM tasks') &&
          sql.includes('work_item_id = $3') &&
          sql.includes('role = $4') &&
          sql.includes('state = ANY($5::task_state[])')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'task-review-rework',
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
          scope: 'agent',
          keyPrefix: 'agent-key',
        } as never,
        {
          title: 'Assess the implementation output',
          workflow_id: 'workflow-1',
          work_item_id: 'review-item-1',
          request_id: 'request-review-child-assessment',
          role: 'acceptance-gate-assessor',
          stage_name: 'review',
          type: 'assessment',
          task_kind: 'assessment',
          input: {
            subject_task_id: 'implementation-task-1',
            subject_revision: 1,
          },
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'task-review-rework',
      }),
    );
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
                assessment_rules: [],
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
          insertedMaxIterations = (values?.[25] as number | null) ?? null;
          insertedLLMMaxRetries = (values?.[26] as number | null) ?? null;
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

  it('persists runtime loop defaults when playbook orchestrator settings are absent', async () => {
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
        if (isPlaybookDefinitionLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                process_instructions: 'Developer implements and reviewer checks it.',
                roles: ['developer', 'reviewer'],
                assessment_rules: [],
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
          insertedMaxIterations = (values?.[25] as number | null) ?? null;
          insertedLLMMaxRetries = (values?.[26] as number | null) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-runtime-loop-defaults',
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
        request_id: 'request-runtime-loop-defaults',
        role: 'developer',
        type: 'code',
      },
    );

    expect(insertedMaxIterations).toBe(500);
    expect(insertedLLMMaxRetries).toBe(5);
    expect(created.max_iterations).toBe(500);
    expect(created.llm_max_retries).toBe(5);
  });

  it('persists playbook max rework iterations into task lifecycle policy metadata', async () => {
    let insertedMetadata: Record<string, unknown> | null = null;
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
        if (isPlaybookDefinitionLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                process_instructions: 'Developer implements and reviewer checks it.',
                roles: ['developer', 'reviewer'],
                assessment_rules: [],
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
                  max_rework_iterations: 5,
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
          insertedMetadata = (values?.[27] as Record<string, unknown>) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-rework-policy',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              metadata: insertedMetadata,
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
        request_id: 'request-rework-policy',
        role: 'developer',
        type: 'code',
      },
    );

    expect(insertedMetadata).toEqual(
      expect.objectContaining({
        task_type: 'code',
        lifecycle_policy: {
          rework: { max_cycles: 5 },
        },
      }),
    );
    expect(created.metadata).toEqual(
      expect.objectContaining({
        task_type: 'code',
        lifecycle_policy: {
          rework: { max_cycles: 5 },
        },
      }),
    );
  });

  it('persists generic assessment task kind and subject linkage metadata', async () => {
    let insertedInput: Record<string, unknown> | null = null;
    let insertedMetadata: Record<string, unknown> | null = null;
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('role = $4') && sql.includes('state = ANY($5::task_state[])')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedInput = (values?.[12] as Record<string, unknown>) ?? null;
          insertedMetadata = (values?.[27] as Record<string, unknown>) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-assessment-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              input: insertedInput,
              metadata: insertedMetadata,
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
        title: 'Assess implementation output',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-assessment-contract',
        role: 'qa',
        type: 'test',
        task_kind: 'assessment',
        subject_task_id: 'task-delivery-1',
        subject_work_item_id: 'work-item-implementation-1',
        subject_handoff_id: 'handoff-delivery-1',
        subject_revision: 2,
      },
    );

    expect(insertedMetadata).toEqual(
      expect.objectContaining({
        task_type: 'test',
        task_kind: 'assessment',
      }),
    );
    expect(insertedInput).toEqual(
      expect.objectContaining({
        subject_task_id: 'task-delivery-1',
        subject_work_item_id: 'work-item-implementation-1',
        subject_handoff_id: 'handoff-delivery-1',
        subject_revision: 2,
      }),
    );
    expect(created.metadata).toEqual(expect.objectContaining({ task_kind: 'assessment' }));
    expect(created.input).toEqual(
      expect.objectContaining({
        subject_task_id: 'task-delivery-1',
        subject_work_item_id: 'work-item-implementation-1',
        subject_handoff_id: 'handoff-delivery-1',
        subject_revision: 2,
      }),
    );
  });

  it('rejects assessment tasks that omit the required subject task linkage', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'verification' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM tasks') && sql.includes('role = $4') && sql.includes('state = ANY($5::task_state[])')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 0, rows: [] };
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

    await expect(service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Assess implementation output',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-assessment-missing-subject',
        role: 'qa',
        type: 'test',
        task_kind: 'assessment',
        subject_revision: 1,
      },
    )).rejects.toThrow('subject_task_id is required for assessment tasks');
  });

  it('defaults workflow task execution context from workspace storage only', async () => {
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
          insertedEnvironment = (values?.[15] as Record<string, unknown>) ?? null;
          insertedBindings = (values?.[16] as string) ?? null;
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
        branch: 'main',
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

  it('ignores branch-only workflow parameters and keeps the workspace branch policy', async () => {
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
          insertedEnvironment = (values?.[15] as Record<string, unknown>) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-branch-only',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              environment: insertedEnvironment,
              resource_bindings: values?.[16] ?? null,
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
        branch: 'main',
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
          insertedBindings = (values?.[16] as string | null) ?? null;
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
          insertedEnvironment = (values?.[15] as Record<string, unknown>) ?? null;
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

  it('rejects workflow specialist tasks that are not linked to a work item', async () => {
    const service = new TaskWriteService({
      pool: {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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

  it('does not inherit repository execution context from workflow parameters', async () => {
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
          insertedEnvironment = (values?.[15] as Record<string, unknown>) ?? null;
          insertedBindings = (values?.[16] as string | null) ?? null;
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
      branch: 'main',
      base_branch: 'main',
      template: 'execution-workspace',
    });
    expect(JSON.parse(insertedBindings ?? '[]')).toEqual([]);
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
              requires_assessment: false,
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
              max_iterations: 500,
              llm_max_retries: 5,
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'escalated', 'completed'],
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

  it('returns the existing completed task when the same work item receives an identical successor dispatch', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'verification' }],
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks')
          && sql.includes('workflow_id = $2')
          && sql.includes('request_id = $3')
        ) {
          return { rowCount: 0, rows: [] };
        }
        if (
          sql.includes('FROM tasks')
          && sql.includes('work_item_id = $3')
          && sql.includes('role = $4')
          && sql.includes('state = ANY($5::task_state[])')
        ) {
          expect(values).toEqual([
            'tenant-1',
            'workflow-1',
            'work-item-1',
            'live-test-qa',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'escalated', 'completed'],
          ]);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-existing-completed',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              workspace_id: null,
              title: 'Validate named greeting and uppercase enhancement',
              priority: 'normal',
              request_id: 'request-existing-completed',
              role: 'live-test-qa',
              stage_name: 'verification',
              state: 'completed',
              depends_on: [],
              requires_approval: false,
              requires_assessment: false,
              input: {
                expected_commit: '3fea712',
                review_handoff_id: 'handoff-1',
              },
              context: {},
              role_config: null,
              environment: {
                template: 'execution-workspace',
              },
              resource_bindings: [],
              activation_id: null,
              is_orchestrator_task: false,
              token_budget: null,
              cost_cap_usd: null,
              auto_retry: false,
              max_retries: 0,
              max_iterations: 500,
              llm_max_retries: 5,
              metadata: {
                description: 'Run QA verification on the approved greeting CLI enhancement.',
                task_type: 'test',
              },
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          throw new Error('should not insert duplicate successor task');
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
        title: 'Validate named greeting and uppercase enhancement',
        description: 'Run QA verification on the approved greeting CLI enhancement.',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-new-completed-duplicate',
        role: 'live-test-qa',
        stage_name: 'verification',
        type: 'test',
        environment: {
          template: 'execution-workspace',
        },
        input: {
          expected_commit: '3fea712',
          review_handoff_id: 'handoff-1',
        },
      },
    );

    expect(result.id).toBe('task-existing-completed');
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
              requires_assessment: false,
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
              max_iterations: 500,
              llm_max_retries: 5,
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
          insertedTokenBudget = (values?.[21] as number) ?? null;
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
                  requires_assessment: false,
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
                  max_iterations: 500,
                  llm_max_retries: 5,
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
              requires_assessment: false,
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
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

  it('returns a recoverable error when a task stage does not match the linked work item stage', async () => {
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
              stage_name: 'design',
              workflow_lifecycle: 'planned',
              stage_status: 'completed',
              stage_gate_status: 'not_requested',
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
          title: 'Create implementation task against design work item',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          request_id: 'recover-stage-mismatch-1',
          role: 'developer',
          stage_name: 'implementation',
        },
      ),
    ).rejects.toThrow(
      /create or move a work item in stage 'implementation' before creating tasks for that stage/i,
    );
  });

  it('rejects creating a planned-stage task for a role that belongs to the successor stage', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{
              workflow_id: 'workflow-1',
              stage_name: 'review',
              workflow_lifecycle: 'planned',
              stage_status: 'active',
              stage_gate_status: 'not_requested',
              owner_role: 'live-test-reviewer',
              next_expected_actor: null,
              next_expected_action: null,
            }],
          };
        }
        if (isPlaybookDefinitionLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{
              definition: {
                process_instructions: 'Reviewer approves in review; QA validates in verification.',
                roles: ['live-test-reviewer', 'live-test-qa'],
                board: {
                  columns: [
                    { id: 'review', label: 'Review' },
                    { id: 'verification', label: 'Verification' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                  entry_column_id: 'review',
                },
                checkpoints: [
                  { name: 'review', goal: 'Reviewer sign-off' },
                  { name: 'verification', goal: 'QA validation' },
                ],
                stages: [
                  { name: 'review', goal: 'Reviewer sign-off', involves: ['live-test-reviewer'] },
                  { name: 'verification', goal: 'QA validation', involves: ['live-test-qa'] },
                ],
                assessment_rules: [],
                approval_rules: [],
                handoff_rules: [{ from_role: 'live-test-reviewer', to_role: 'live-test-qa', checkpoint: 'review', required: true }],
                lifecycle: 'planned',
              },
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
          title: 'QA validate greeting enhancement after review approval',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          request_id: 'wrong-stage-qa-1',
          role: 'live-test-qa',
          stage_name: 'review',
        },
      ),
    ).rejects.toThrow(
      /Route successor work into stage 'verification' before dispatching role 'live-test-qa'/i,
    );
  });
});
