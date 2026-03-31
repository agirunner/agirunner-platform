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

  it('creates a task as ready when all dependencies are already completed', async () => {
    let insertedState: string | null = null;
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{ workflow_id: 'workflow-1', stage_name: 'drafting' }],
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
          return { rowCount: 0, rows: [] };
        }
        if (sql === 'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])') {
          return { rowCount: 1, rows: [{ id: 'task-upstream' }] };
        }
        if (
          sql ===
          "SELECT 1 FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND state <> 'completed' LIMIT 1"
        ) {
          expect(values).toEqual(['tenant-1', ['task-upstream']]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          insertedState = (values?.[8] as string) ?? null;
          return {
            rowCount: 1,
            rows: [{
              id: 'task-ready',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              request_id: 'request-ready-after-completed-dependency',
              role: 'technical-editor',
              stage_name: 'drafting',
              state: insertedState,
              depends_on: ['task-upstream'],
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
        title: 'Refine brief after completed dependency',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        request_id: 'request-ready-after-completed-dependency',
        role: 'technical-editor',
        depends_on: ['task-upstream'],
      },
    );

    expect(insertedState).toBe('ready');
    expect(result.state).toBe('ready');
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
          insertedTokenBudget = (values?.[19] as number) ?? null;
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

});
