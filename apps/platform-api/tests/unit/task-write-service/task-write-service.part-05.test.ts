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
          insertedInput = (values?.[10] as Record<string, unknown>) ?? null;
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
        subject_task_id: 'task-delivery-1',
        subject_work_item_id: 'work-item-implementation-1',
        subject_handoff_id: 'handoff-delivery-1',
        subject_revision: 2,
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
    expect(created.metadata).toEqual(
      expect.objectContaining({
        task_kind: 'assessment',
        subject_task_id: 'task-delivery-1',
        subject_work_item_id: 'work-item-implementation-1',
        subject_handoff_id: 'handoff-delivery-1',
        subject_revision: 2,
      }),
    );
    expect(created.input).toEqual(
      expect.objectContaining({
        subject_task_id: 'task-delivery-1',
        subject_work_item_id: 'work-item-implementation-1',
        subject_handoff_id: 'handoff-delivery-1',
        subject_revision: 2,
      }),
    );
  });

  it('derives and persists assessment task_kind from the public assessment task type', async () => {
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
          insertedMetadata = (values?.[27] as Record<string, unknown>) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-assessment-typed-1',
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
        title: 'Assess implementation output',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-assessment-type-derived',
        role: 'qa',
        type: 'assessment',
        subject_task_id: 'task-delivery-1',
        subject_revision: 1,
      },
    );

    expect(insertedMetadata).toEqual(
      expect.objectContaining({
        task_type: 'assessment',
        task_kind: 'assessment',
        subject_task_id: 'task-delivery-1',
        subject_revision: 1,
      }),
    );
    expect(created.metadata).toEqual(
      expect.objectContaining({
        task_kind: 'assessment',
        subject_task_id: 'task-delivery-1',
        subject_revision: 1,
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
          insertedEnvironment = (values?.[13] as Record<string, unknown>) ?? null;
          insertedBindings = (values?.[14] as string) ?? null;
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

});
