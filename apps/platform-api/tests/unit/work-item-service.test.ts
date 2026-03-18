import { describe, expect, it, vi } from 'vitest';

import { ConflictError } from '../../src/errors/domain-errors.js';
import { WorkItemService } from '../../src/services/work-item-service.js';

describe('WorkItemService', () => {
  it('uses the playbook default stage for planned work items when stage_name is omitted', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain('FOR UPDATE OF w');
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'implementation',
                lifecycle: 'planned',
                definition: {
                  roles: ['implementer'],
                  lifecycle: 'planned',
                  board: { columns: [{ id: 'planned', label: 'Planned' }] },
                  stages: [
                    { name: 'requirements', goal: 'Define scope' },
                    { name: 'implementation', goal: 'Ship code' },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('request_id = $3')) {
          expect(sql).not.toContain('SELECT *');
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          expect(sql).not.toContain('RETURNING *');
          expect(params?.[4]).toBe('requirements');
          return {
            rows: [
              {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                stage_name: 'requirements',

                column_id: 'planned',
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT ws.id,') && sql.includes('FROM workflow_stages ws')) {
          return {
            rows: [
              {
                id: 'stage-1',
                lifecycle: 'planned',
                name: 'requirements',
                position: 0,
                goal: 'Define scope',
                guidance: null,
                human_gate: false,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: new Date('2026-03-17T20:00:00Z'),
                completed_at: null,
                open_work_item_count: 1,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-17T20:00:00Z'),
                last_completed_work_item_at: null,
              },
              {
                id: 'stage-2',
                lifecycle: 'planned',
                name: 'implementation',
                position: 1,
                goal: 'Ship code',
                guidance: null,
                human_gate: false,
                status: 'pending',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 0,
                first_work_item_at: null,
                last_completed_work_item_at: null,
              },
            ],
            rowCount: 2,
          };
        }
        if (sql.includes('UPDATE workflows')) {
          throw new Error('planned work-item reconciliation should not persist workflow.current_stage');
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const activationService = { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) };
    const activationDispatchService = { dispatchActivation: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkItemService(
      pool as never,
      eventService as never,
      activationService as never,
      activationDispatchService as never,
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
        title: 'Backfill scope notes',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'work-item-1',
        stage_name: 'requirements',
      }),
    );
    expect(result).not.toHaveProperty('current_checkpoint');
  });

  it('marks webhook-triggered work items as webhook-created and emits system-scoped events', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain('FOR UPDATE OF w');
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
        if (sql.includes('FROM workflow_work_items') && sql.includes('request_id = $3')) {
          expect(sql).not.toContain('SELECT *');
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          expect(params?.[4]).toBe('triage');
          expect(params?.[12]).toBe(0);
          expect(params?.[15]).toBe('webhook');
          return {
            rows: [
              {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                stage_name: 'triage',

                column_id: 'planned',
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
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
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const activationService = { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) };
    const activationDispatchService = { dispatchActivation: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkItemService(
      pool as never,
      eventService as never,
      activationService as never,
      activationDispatchService as never,
    );

    const result = await service.createWorkItem(
      {
        id: 'trigger:1',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'webhook_trigger',
        ownerId: null,
        keyPrefix: 'trigger:trigger-1',
      },
      'workflow-1',
      {
        request_id: 'trigger:trigger-1:evt-1',
        title: 'Incoming webhook item',
      },
    );

    expect(result.id).toBe('work-item-1');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.created',
        entityType: 'work_item',
        entityId: 'work-item-1',
        actorType: 'system',
        actorId: 'trigger:trigger-1',
        data: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
        }),
      }),
      client,
    );
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'system',
        actorId: 'trigger:trigger-1',
        requestId: 'work-item:trigger:trigger-1:evt-1',
      }),
      client,
    );
  });

  it('returns the existing work item when request_id conflicts', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain('FOR UPDATE OF w');
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'triage',
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
        if (sql.includes('INSERT INTO workflow_work_items')) {
          expect(sql).not.toContain('RETURNING *');
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('request_id = $3')) {
          expect(sql).not.toContain('SELECT *');
          expect(params).toEqual(['tenant-1', 'workflow-1', 'req-1']);
          return {
            rows: [
              {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                request_id: 'req-1',
                parent_work_item_id: null,
                stage_name: 'triage',

                title: 'Incoming webhook item',
                goal: null,
                acceptance_criteria: null,
                column_id: 'planned',
                owner_role: null,
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
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
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const activationService = { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) };
    const activationDispatchService = { dispatchActivation: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkItemService(
      pool as never,
      eventService as never,
      activationService as never,
      activationDispatchService as never,
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
        title: 'Incoming webhook item',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'work-item-1',
        request_id: 'req-1',
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(activationDispatchService.dispatchActivation).not.toHaveBeenCalled();
  });

  it('rejects a request_id replay when the existing work item does not match the requested mutation', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
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
      query: vi.fn(async (sql: string) => {
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
      query: vi.fn(async (sql: string) => {
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
                next_expected_action: 'review',
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
    expect((workItem as Record<string, any>).next_expected_action).toBe('review');
    expect((workItem as Record<string, any>).rework_count).toBe(2);
    expect((event as Record<string, any>).data.api_key).toBe('redacted://work-item-secret');
    expect((event as Record<string, any>).data.secret_ref).toBe('redacted://work-item-secret');
  });

  it('preserves timestamp fields while redacting work-item secrets', async () => {
    const completedAt = new Date('2026-03-16T11:42:54.378Z');
    const createdAt = new Date('2026-03-16T11:40:00.000Z');
    const updatedAt = new Date('2026-03-16T11:42:54.378Z');
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          return {
            rows: [
              {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'requirements',

                column_id: 'done',
                completed_at: completedAt,
                created_at: createdAt,
                updated_at: updatedAt,
                metadata: {
                  webhook_secret: 'plaintext-secret',
                },
                task_count: '0',
                children_count: '0',
                children_completed: '0',
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

    expect((workItem as Record<string, any>).metadata.webhook_secret).toBe('redacted://work-item-secret');
    expect((workItem as Record<string, any>).completed_at).toEqual(completedAt);
    expect((workItem as Record<string, any>).created_at).toEqual(createdAt);
    expect((workItem as Record<string, any>).updated_at).toEqual(updatedAt);
  });

  it('lists milestone-aware work items with filters and grouped children', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        expect(sql).not.toContain('wi.*');
        expect(sql).toContain('COUNT(DISTINCT child.id)::int AS children_count');
        expect(sql).toContain('COUNT(DISTINCT child.id) FILTER (WHERE child.completed_at IS NOT NULL)::int AS children_completed');
        expect(sql).toContain('wi.stage_name = $3');
        expect(sql).toContain('wi.column_id = $4');
        expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation', 'active']);
        return {
          rows: [
            {
              id: 'wi-parent',
              workflow_id: 'workflow-1',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Auth milestone',
              column_id: 'active',
              priority: 'high',
              task_count: '1',
              children_count: '2',
              children_completed: '1',
              created_at: '2026-03-11T00:00:00.000Z',
            },
            {
              id: 'wi-child',
              workflow_id: 'workflow-1',
              parent_work_item_id: 'wi-parent',
              stage_name: 'implementation',
              title: 'Auth implementation',
              column_id: 'active',
              priority: 'normal',
              task_count: '2',
              children_count: '0',
              children_completed: '0',
              created_at: '2026-03-11T00:01:00.000Z',
            },
          ],
          rowCount: 2,
        };
      }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const workItems = await service.listWorkflowWorkItems('tenant-1', 'workflow-1', {
      stage_name: 'implementation',
      column_id: 'active',
      grouped: true,
    });

    expect(workItems).toEqual([
      expect.objectContaining({
        id: 'wi-parent',
        task_count: 1,
        children_count: 2,
        children_completed: 1,
        is_milestone: true,
        children: [
          expect.objectContaining({
            id: 'wi-child',
            parent_work_item_id: 'wi-parent',
            children_count: 0,
            children_completed: 0,
            is_milestone: false,
            task_count: 2,
          }),
        ],
      }),
    ]);
  });

  it('filters work items by parent_work_item_id for child reads', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        expect(sql).toContain('wi.parent_work_item_id = $3');
        expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-parent']);
        return {
          rows: [
            {
              id: 'wi-child',
              workflow_id: 'workflow-1',
              parent_work_item_id: 'wi-parent',
              stage_name: 'implementation',
              title: 'Auth implementation',
              column_id: 'active',
              priority: 'normal',
              task_count: '2',
              children_count: '0',
              children_completed: '0',
              created_at: '2026-03-11T00:01:00.000Z',
            },
          ],
          rowCount: 1,
        };
      }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const workItems = await service.listWorkflowWorkItems('tenant-1', 'workflow-1', {
      parent_work_item_id: 'wi-parent',
    });

    expect(workItems).toEqual([
      expect.objectContaining({
        id: 'wi-child',
        parent_work_item_id: 'wi-parent',
        children_count: 0,
        children_completed: 0,
        is_milestone: false,
      }),
    ]);
  });

  it('returns a work item with milestone children when requested', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'wi-parent',
              workflow_id: 'workflow-1',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Auth milestone',
              column_id: 'active',
              priority: 'high',
              task_count: '1',
              children_count: '2',
              children_completed: '1',
              created_at: '2026-03-11T00:00:00.000Z',
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'wi-child-1',
              workflow_id: 'workflow-1',
              parent_work_item_id: 'wi-parent',
              stage_name: 'implementation',
              title: 'Auth implementation',
              column_id: 'active',
              priority: 'normal',
              task_count: '2',
              children_count: '0',
              children_completed: '0',
              created_at: '2026-03-11T00:01:00.000Z',
            },
            {
              id: 'wi-child-2',
              workflow_id: 'workflow-1',
              parent_work_item_id: 'wi-parent',
              stage_name: 'implementation',
              title: 'Auth review',
              column_id: 'review',
              priority: 'normal',
              task_count: '1',
              children_count: '0',
              children_completed: '0',
              created_at: '2026-03-11T00:02:00.000Z',
            },
          ],
          rowCount: 2,
        }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const workItem = await service.getWorkflowWorkItem('tenant-1', 'workflow-1', 'wi-parent', {
      include_children: true,
    });

    expect(workItem).toEqual(
      expect.objectContaining({
        id: 'wi-parent',
        children_count: 2,
        children_completed: 1,
        is_milestone: true,
        children: [
          expect.objectContaining({ id: 'wi-child-1', is_milestone: false }),
          expect.objectContaining({ id: 'wi-child-2', is_milestone: false }),
        ],
      }),
    );
  });

  it('returns milestone children by default when the selected work item is a parent', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'wi-parent',
              workflow_id: 'workflow-1',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Auth milestone',
              column_id: 'active',
              priority: 'high',
              task_count: '1',
              children_count: '1',
              children_completed: '0',
              created_at: '2026-03-11T00:00:00.000Z',
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'wi-child-1',
              workflow_id: 'workflow-1',
              parent_work_item_id: 'wi-parent',
              stage_name: 'implementation',
              title: 'Auth implementation',
              column_id: 'active',
              priority: 'normal',
              task_count: '2',
              children_count: '0',
              children_completed: '0',
              created_at: '2026-03-11T00:01:00.000Z',
            },
          ],
          rowCount: 1,
        }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const workItem = await service.getWorkflowWorkItem('tenant-1', 'workflow-1', 'wi-parent');

    expect(workItem).toEqual(
      expect.objectContaining({
        id: 'wi-parent',
        children: [expect.objectContaining({ id: 'wi-child-1' })],
      }),
    );
  });

  it('returns latest gate feedback in the work-item continuity model', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        expect(sql).toContain('workflow_stage_gates');
        return {
          rowCount: 1,
          rows: [
            {
              id: 'wi-1',
              workflow_id: 'wf-1',
              parent_work_item_id: null,
              stage_name: 'release',
              column_id: 'planned',
              owner_role: 'product-manager',
              next_expected_actor: 'human',
              next_expected_action: 'approve',
              rework_count: 2,
              latest_handoff_completion: 'full',
              unresolved_findings: ['Replace the static page with the required CLI entrypoint.'],
              review_focus: ['Release deliverable must match approved CLI scope.'],
              known_risks: ['Release package is blocked until the CLI deliverable exists.'],
              task_count: 1,
              children_count: 0,
              children_completed: 0,
              completed_at: null,
              gate_status: 'rejected',
              gate_decision_feedback:
                'Release approval rejected: expected CLI entrypoint hello.py is missing from the workflow branch.',
              gate_decided_at: new Date('2026-03-16T16:31:49.959Z'),
            },
          ],
        };
      }),
    };

    const service = new WorkItemService(pool as never, {} as never, {} as never, {} as never);

    const workItem = await service.getWorkflowWorkItem('tenant-1', 'wf-1', 'wi-1');

    expect(workItem).toMatchObject({
      id: 'wi-1',
      workflow_id: 'wf-1',
      stage_name: 'release',
      gate_status: 'rejected',
      gate_decision_feedback:
        'Release approval rejected: expected CLI entrypoint hello.py is missing from the workflow branch.',
    });
    expect(workItem).not.toHaveProperty('current_checkpoint');
    expect(workItem.gate_decided_at).toEqual(new Date('2026-03-16T16:31:49.959Z'));
  });
});
