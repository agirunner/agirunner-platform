import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logSafetynetTriggeredMock } from './work-item-service-test-support.js';

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: logSafetynetTriggeredMock,
}));

import { ConflictError, ValidationError } from '../../../src/errors/domain-errors.js';
import { WorkItemService } from '../../../src/services/work-item-service.js';

const identity = {
  tenantId: 'tenant-1',
  scope: 'admin',
  keyPrefix: 'admin-key',
};

beforeEach(() => {
  logSafetynetTriggeredMock.mockReset();
});

describe('WorkItemService', () => {
  it('rejects a request_id replay when the existing work item does not match the requested mutation', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'triage',
                lifecycle: 'ongoing',
                definition: {
                  roles: ['triager'],
                  lifecycle: 'ongoing',
                  board: { columns: [{ id: 'planned', label: 'Planned' }] },
                  stages: [{ name: 'triage', goal: 'Triage inbound work' }],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'triage']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('request_id = $3')) {
          return {
            rows: [
              {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                request_id: 'req-1',
                parent_work_item_id: null,
                stage_name: 'triage',
                title: 'Existing title',
                goal: null,
                acceptance_criteria: null,
                column_id: 'planned',
                owner_role: null,
                priority: 'normal',
                notes: null,
                metadata: {},
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
      { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) } as never,
      { dispatchActivation: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(
      service.createWorkItem(
        {
          id: 'admin:1',
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: 'tenant-1',
          keyPrefix: 'admin-key',
        },
        'workflow-1',
        {
          request_id: 'req-1',
          title: 'New title',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('treats metadata with reordered object keys as the same work-item replay', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'triage',
                lifecycle: 'ongoing',
                definition: {
                  roles: ['triager'],
                  lifecycle: 'ongoing',
                  board: { columns: [{ id: 'planned', label: 'Planned' }] },
                  stages: [{ name: 'triage', goal: 'Triage inbound work' }],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'triage']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('request_id = $3')) {
          return {
            rows: [
              {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                request_id: 'req-1',
                parent_work_item_id: null,
                stage_name: 'triage',

                title: 'Existing title',
                goal: null,
                acceptance_criteria: null,
                column_id: 'planned',
                owner_role: null,
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                priority: 'normal',
                notes: null,
                metadata: {
                  nested: { first: 'one', second: 'two' },
                  status: 'open',
                },
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
      { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) } as never,
      { dispatchActivation: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.createWorkItem(
      {
        id: 'admin:1',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin-key',
      },
      'workflow-1',
      {
        request_id: 'req-1',
        title: 'Existing title',
        metadata: {
          status: 'open',
          nested: { second: 'two', first: 'one' },
        },
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'work-item-1',
        request_id: 'req-1',
      }),
    );
  });

  it('redacts plaintext secrets from create-work-item responses', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain('FOR UPDATE OF w');
          return {
            rows: [{
              id: 'workflow-1',
              active_stage_name: 'triage',
              definition: {
                roles: ['triager'],
                lifecycle: 'ongoing',
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                stages: [{ name: 'triage', goal: 'Triage inbound work' }],
              },
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'triage']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          return {
            rows: [{
              id: 'work-item-1',
              workflow_id: 'workflow-1',
              stage_name: 'triage',
              column_id: 'planned',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              metadata: {
                webhook_secret: 'plaintext-secret',
                secret_ref: 'secret:WORK_ITEM_SECRET',
              },
            }],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkItemService(
      { connect: vi.fn().mockResolvedValue(client) } as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
      { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) } as never,
      { dispatchActivation: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.createWorkItem(
      {
        id: 'admin:1',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin-key',
      },
      'workflow-1',
      {
        title: 'Create item',
        metadata: { webhook_secret: 'plaintext-secret' },
      },
    );

    expect((result as Record<string, any>).metadata.webhook_secret).toBe('redacted://work-item-secret');
    expect((result as Record<string, any>).metadata.secret_ref).toBe('redacted://work-item-secret');
  });

  it('lists work-item tasks through a dedicated subresource query', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT wi.id, wi.workflow_id, w.workspace_id')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rows: [{ id: 'work-item-1', workflow_id: 'workflow-1', workspace_id: 'workspace-1' }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('work_item_id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rows: [
              {
                id: 'task-1',
                workflow_id: 'workflow-1',
                work_item_id: 'work-item-1',
                title: 'Implement feature',
                state: 'ready',
                role: 'developer',
                stage_name: 'implementation',
                activation_id: 'activation-1',
                is_orchestrator_task: false,
                created_at: '2026-03-11T00:00:00.000Z',
                completed_at: null,
                depends_on: [],
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const tasks = await service.listWorkItemTasks('tenant-1', 'workflow-1', 'work-item-1');

    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'task-1',
        work_item_id: 'work-item-1',
        stage_name: 'implementation',
      }),
    ]);
  });

  it('lists work-item events through a dedicated subresource query', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT wi.id, wi.workflow_id, w.workspace_id')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rows: [{ id: 'work-item-1', workflow_id: 'workflow-1', workspace_id: 'workspace-1' }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM events')) {
          expect(sql).toContain('ORDER BY created_at DESC, id DESC');
          expect(params).toEqual(['tenant-1', 'work-item-1', 'workflow-1', 'work-item-1', 50]);
          return {
            rows: [
              {
                id: 1,
                entity_type: 'work_item',
                entity_id: 'work-item-1',
                type: 'work_item.updated',
                data: { workflow_id: 'workflow-1', work_item_id: 'work-item-1' },
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const events = await service.listWorkItemEvents('tenant-1', 'workflow-1', 'work-item-1', 50);

    expect(events).toEqual([
      expect.objectContaining({
        entity_type: 'work_item',
        entity_id: 'work-item-1',
        type: 'work_item.updated',
      }),
    ]);
  });

  it('redacts plaintext secrets from work-item metadata and event payloads', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT wi.id, wi.workflow_id, w.workspace_id')) {
          return {
            rows: [{ id: 'work-item-1', workflow_id: 'workflow-1', workspace_id: 'workspace-1' }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items wi')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          return {
            rows: [
              {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'triage',

                column_id: 'planned',
                next_expected_actor: 'reviewer',
                next_expected_action: 'assess',
                rework_count: 2,
                metadata: {
                  webhook_secret: 'plaintext-secret',
                  secret_ref: 'secret:WORK_ITEM_SECRET',
                },
                task_count: '0',
                children_count: '0',
                children_completed: '0',
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM events')) {
          return {
            rows: [
              {
                id: 1,
                entity_type: 'work_item',
                entity_id: 'work-item-1',
                type: 'work_item.updated',
                data: {
                  api_key: 'sk-event-secret',
                  secret_ref: 'secret:EVENT_TOKEN',
                },
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const [workItem] = await service.listWorkflowWorkItems('tenant-1', 'workflow-1');
    const [event] = await service.listWorkItemEvents('tenant-1', 'workflow-1', 'work-item-1', 20);

    expect((workItem as Record<string, any>).metadata.webhook_secret).toBe('redacted://work-item-secret');
    expect((workItem as Record<string, any>).metadata.secret_ref).toBe('redacted://work-item-secret');
    expect((workItem as Record<string, any>).stage_name).toBe('triage');
    expect((workItem as Record<string, any>).current_checkpoint).toBeUndefined();
    expect((workItem as Record<string, any>).next_expected_actor).toBe('reviewer');
    expect((workItem as Record<string, any>).next_expected_action).toBe('assess');
    expect((workItem as Record<string, any>).rework_count).toBe(2);
    expect((event as Record<string, any>).data.api_key).toBe('redacted://work-item-secret');
    expect((event as Record<string, any>).data.secret_ref).toBe('redacted://work-item-secret');
  });
});
