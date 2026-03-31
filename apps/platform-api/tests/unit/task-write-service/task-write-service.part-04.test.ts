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
                stages: [
                  { name: 'implementation', goal: 'Implement the work.' },
                ],
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
          insertedMaxIterations = (values?.[23] as number | null) ?? null;
          insertedLLMMaxRetries = (values?.[24] as number | null) ?? null;
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
                stages: [
                  { name: 'implementation', goal: 'Implement the work.' },
                ],
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
          insertedMaxIterations = (values?.[23] as number | null) ?? null;
          insertedLLMMaxRetries = (values?.[24] as number | null) ?? null;
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
                stages: [
                  { name: 'implementation', goal: 'Implement the work.' },
                ],
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

});
