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

  it('queues tasks when playbook parallelism capacity is full', async () => {
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
              id: 'task-pending-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              state: 'pending',
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
        title: 'Queued task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
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

  it('keeps tasks ready when capacity is available', async () => {
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
              id: 'task-ready-2',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              state: 'ready',
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
        title: 'Ready task',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
      },
    );

    expect(result.state).toBe('ready');
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
                stages: [
                  { name: 'review', goal: 'Reviewer sign-off', involves: ['live-test-reviewer'] },
                  { name: 'verification', goal: 'QA validation', involves: ['live-test-qa'] },
                ],
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

  it('rejects creating a planned-stage task for a role that is not defined in the workflow playbook', async () => {
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
              stage_name: 'approval-gate',
              workflow_lifecycle: 'planned',
              stage_status: 'active',
              stage_gate_status: 'changes_requested',
              owner_role: 'rework-technical-editor',
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
                process_instructions: 'A human review gate decides after the technical editor prepares the packet.',
                roles: ['rework-product-strategist', 'rework-technical-editor', 'rework-launch-planner'],
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                  entry_column_id: 'planned',
                },
                stages: [
                  { name: 'approval-gate', goal: 'A human decision exists for the brief.', involves: [] },
                ],
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
          title: 'Record the human gate decision',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          request_id: 'undefined-human-gate-role-1',
          role: 'human-review-gate',
          stage_name: 'approval-gate',
        },
      ),
  ).rejects.toThrow(/Role 'human-review-gate' is not defined in planned workflow playbook 'workflow-1'/i);
  });
});
