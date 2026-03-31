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

  it('does not derive output assessment from deleted playbook review config', async () => {
    let insertSql = '';
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
                stages: [
                  {
                    name: 'implementation',
                    goal: 'Implement and inspect the change.',
                    involves: ['developer', 'reviewer', 'qa'],
                  },
                ],
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
          insertSql = sql;
          return {
            rowCount: 1,
            rows: [{
              id: 'review-task-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
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
        subject_task_id: 'task-developer-1',
        subject_revision: 1,
      },
    );

    expect(insertSql).not.toContain('requires_assessment');
  });

  it('does not infer output assessment from stage names alone', async () => {
    const insertStatements: string[] = [];
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
                stages: [
                  { name: 'reproduce', goal: 'Reproduce the issue.' },
                  { name: 'test', goal: 'Verify the fix.' },
                ],
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
          insertStatements.push(sql);
          return {
            rowCount: 1,
            rows: [{
              id: `task-${insertStatements.length}`,
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: values?.[2],
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

    expect(insertStatements).toHaveLength(2);
    expect(insertStatements.every((sql) => !sql.includes('requires_assessment'))).toBe(true);
  });

  it('rejects creating a task for a terminated workflow branch', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{
              workflow_id: 'workflow-1',
              parent_work_item_id: null,
              stage_name: 'publication',
              workflow_lifecycle: 'planned',
              stage_status: 'active',
              stage_gate_status: 'not_requested',
              owner_role: 'release-editor',
              next_expected_actor: 'release-editor',
              next_expected_action: 'handoff',
              branch_id: 'branch-1',
              branch_status: 'terminated',
            }],
          };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          throw new Error('task insert should not run for a terminated branch');
        }
        if (sql.includes('JOIN playbooks pb')) {
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

    await expect(
      service.createTask(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        {
          title: 'Continue deprecated release branch',
          work_item_id: 'work-item-1',
          role: 'release-editor',
        },
      ),
    ).rejects.toThrow('Cannot create new tasks for terminated branch');
  });

  it('propagates linked work item branch ids into created tasks', async () => {
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isLinkedWorkItemLookup(sql)) {
          return {
            rowCount: 1,
            rows: [{
              workflow_id: 'workflow-1',
              parent_work_item_id: null,
              stage_name: 'publication',
              workflow_lifecycle: 'planned',
              stage_status: 'active',
              stage_gate_status: 'not_requested',
              owner_role: 'release-editor',
              next_expected_actor: 'release-editor',
              next_expected_action: 'handoff',
              branch_id: 'branch-1',
              branch_status: 'active',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('workflow_id = $2') && sql.includes('request_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('JOIN playbooks pb')) {
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
        if (sql.includes('FROM workflows w') && sql.includes('LEFT JOIN workspaces p')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('INSERT INTO tasks')) {
          expect(sql).toContain('branch_id');
          expect(values).toContain('branch-1');
          expect(values?.[values.length - 1]).toMatchObject({ branch_id: 'branch-1' });
          return {
            rowCount: 1,
            rows: [{
              id: 'task-branch-1',
              tenant_id: 'tenant-1',
              branch_id: 'branch-1',
              metadata: { branch_id: 'branch-1' },
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

    const task = await service.createTask(
      {
        tenantId: 'tenant-1',
        scope: 'admin',
        keyPrefix: 'admin-key',
      } as never,
      {
        title: 'Continue deprecated release branch',
        request_id: 'task-branch-1',
        work_item_id: 'work-item-1',
        role: 'release-editor',
      },
    );

    expect(task).toMatchObject({
      branch_id: 'branch-1',
      metadata: { branch_id: 'branch-1' },
    });
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

});
