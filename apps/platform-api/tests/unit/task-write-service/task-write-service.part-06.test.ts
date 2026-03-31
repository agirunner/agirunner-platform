import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  ValidationError,
  TaskWriteService,
  readRequiredPositiveIntegerRuntimeDefaultMock,
  logSafetynetTriggeredMock,
  resetTaskWriteServiceMocks,
  isLinkedWorkItemLookup,
  isPlaybookDefinitionLookup,
} from './task-write-service-test-support.js';

describe('TaskWriteService', () => {
  beforeEach(() => {
    resetTaskWriteServiceMocks();
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
          insertedBindings = (values?.[14] as string | null) ?? null;
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
          insertedEnvironment = (values?.[13] as Record<string, unknown>) ?? null;
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

});
