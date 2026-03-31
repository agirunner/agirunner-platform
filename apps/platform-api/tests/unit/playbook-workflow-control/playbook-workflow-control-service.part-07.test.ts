import { describe, expect, it, vi } from 'vitest';

import { ConflictError, ValidationError } from '../../../src/errors/domain-errors.js';
import { PlaybookWorkflowControlService } from '../../../src/services/playbook-workflow-control/playbook-workflow-control-service.js';

const definition = {
  lifecycle: 'planned',
  board: {
    columns: [
      { id: 'planned', label: 'Planned' },
      { id: 'done', label: 'Done', is_terminal: true },
    ],
  },
  stages: [
    { name: 'requirements', goal: 'Define scope' },
    { name: 'implementation', goal: 'Ship code' },
  ],
};

describe('PlaybookWorkflowControlService', () => {

  it('treats a no-op work-item patch as idempotent and skips side effects', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-9' })),
    };
    const dispatchService = {
      dispatchActivation: vi.fn(async () => 'task-9'),
    };
    const stateService = {
      recomputeWorkflowState: vi.fn(async () => 'active'),
    };
    const updatedAt = new Date('2026-03-11T00:00:00Z');
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain('FOR UPDATE OF w');
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              workspace_id: 'workspace-1',
              playbook_id: 'playbook-1',
              lifecycle: 'planned',
              active_stage_name: 'requirements',
              state: 'active',
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-2',
              parent_work_item_id: 'wi-1',
              stage_name: 'requirements',
              title: 'Implement scope',
              goal: 'Ship it',
              acceptance_criteria: 'works',
              column_id: 'planned',
              owner_role: 'engineer',
              priority: 'normal',
              notes: null,
              completed_at: null,
              metadata: { lane: 'alpha' },
              updated_at: updatedAt,
            }],
          };
        }
        if (sql.includes('WITH RECURSIVE descendants')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('LIMIT 1') && !sql.includes('FOR UPDATE')) {
          return { rowCount: 1, rows: [{ id: 'wi-1' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: eventService as never,
      stateService: stateService as never,
      activationService: activationService as never,
      activationDispatchService: dispatchService as never,
    });

    const updated = await service.updateWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-2',
      {
        parent_work_item_id: 'wi-1',
        title: ' Implement scope ',
        goal: 'Ship it',
        acceptance_criteria: 'works',
        stage_name: 'requirements',
        column_id: 'planned',
        owner_role: 'engineer',
        priority: 'normal',
        notes: null,
        metadata: { lane: 'alpha' },
      },
      pool as never,
    );

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'wi-2',
        updated_at: updatedAt.toISOString(),
        metadata: { lane: 'alpha' },
      }),
    );
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE workflow_work_items'), expect.anything());
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(dispatchService.dispatchActivation).not.toHaveBeenCalled();
    expect(stateService.recomputeWorkflowState).not.toHaveBeenCalled();
  });


  it('completes a work item by resolving the terminal column server-side', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-9' })),
    };
    const dispatchService = {
      dispatchActivation: vi.fn(async () => 'task-9'),
    };
    const stateService = {
      recomputeWorkflowState: vi.fn(async () => 'active'),
    };
    const updatedAt = new Date('2026-03-11T02:00:00Z');
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain('FOR UPDATE OF w');
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              workspace_id: 'workspace-1',
              playbook_id: 'playbook-1',
              lifecycle: 'ongoing',
              active_stage_name: null,
              state: 'active',
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-ongoing-1',
              parent_work_item_id: null,
              stage_name: 'requirements',
              title: 'Triage request',
              goal: 'Clarify the incoming ask',
              acceptance_criteria: 'Next action is unblocked',
              column_id: 'planned',
              owner_role: 'analyst',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'normal',
              notes: null,
              completed_at: null,
              metadata: { lane: 'default' },
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs th')
          && sql.includes("COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'")
          && sql.includes('AND th.role = $4')
        ) {
          return {
            rowCount: 0,
            rows: [],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(params?.[8]).toBe('done');
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-ongoing-1',
              parent_work_item_id: null,
              stage_name: 'requirements',
              title: 'Triage request',
              goal: 'Clarify the incoming ask',
              acceptance_criteria: 'Next action is unblocked',
              column_id: 'done',
              owner_role: 'analyst',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'normal',
              notes: null,
              completed_at: new Date('2026-03-11T02:00:00Z'),
              metadata: { lane: 'default' },
              updated_at: updatedAt,
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('work_item_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: eventService as never,
      stateService: stateService as never,
      activationService: activationService as never,
      activationDispatchService: dispatchService as never,
    });

    const updated = await service.completeWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-ongoing-1',
      {},
      pool as never,
    );

    expect(updated.column_id).toBe('done');
    expect(updated.completed_at).toBe('2026-03-11T02:00:00.000Z');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.completed',
        entityType: 'work_item',
        entityId: 'wi-ongoing-1',
      }),
      pool,
    );
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        eventType: 'work_item.updated',
        payload: expect.objectContaining({
          work_item_id: 'wi-ongoing-1',
          previous_column_id: 'planned',
          column_id: 'done',
        }),
      }),
      pool,
    );
    expect(dispatchService.dispatchActivation).toHaveBeenCalledWith('tenant-1', 'activation-9', pool);
    expect(stateService.recomputeWorkflowState).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      pool,
      expect.objectContaining({ actorType: 'admin', actorId: 'k1' }),
    );
  });


  it('treats completeWorkItem as idempotent when the work item is already terminal', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-9' })),
    };
    const dispatchService = {
      dispatchActivation: vi.fn(async () => 'task-9'),
    };
    const stateService = {
      recomputeWorkflowState: vi.fn(async () => 'active'),
    };
    const completedAt = new Date('2026-03-11T02:00:00Z');
    const updatedAt = new Date('2026-03-11T02:00:30Z');
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain('FOR UPDATE OF w');
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              workspace_id: 'workspace-1',
              playbook_id: 'playbook-1',
              lifecycle: 'ongoing',
              active_stage_name: null,
              state: 'active',
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-ongoing-1',
              parent_work_item_id: null,
              stage_name: 'requirements',
              title: 'Triage request',
              goal: 'Clarify the incoming ask',
              acceptance_criteria: 'Next action is unblocked',
              column_id: 'done',
              owner_role: 'analyst',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'normal',
              notes: null,
              completed_at: completedAt,
              metadata: { lane: 'default' },
              updated_at: updatedAt,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: eventService as never,
      stateService: stateService as never,
      activationService: activationService as never,
      activationDispatchService: dispatchService as never,
    });

    const updated = await service.completeWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-ongoing-1',
      {},
      pool as never,
    );

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'wi-ongoing-1',
        column_id: 'done',
        completed_at: completedAt.toISOString(),
        updated_at: updatedAt.toISOString(),
      }),
    );
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE workflow_work_items'), expect.anything());
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(dispatchService.dispatchActivation).not.toHaveBeenCalled();
    expect(stateService.recomputeWorkflowState).not.toHaveBeenCalled();
  });


  it('rejects completing a work item that still has a blocking rejected assessment', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain('FOR UPDATE OF w');
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              workspace_id: 'workspace-1',
              playbook_id: 'playbook-1',
              lifecycle: 'planned',
              active_stage_name: 'implementation',
              state: 'active',
              definition,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-implementation-1',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Implement the reporting pipeline',
              goal: 'Ship the feature',
              acceptance_criteria: 'The reporting pipeline is complete.',
              column_id: 'planned',
              owner_role: 'implementer',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: {},
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          expect(sql).toContain('th.work_item_id = $3');
          expect(sql).not.toContain('th.work_item_id = $4');
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-implementation-1']);
          return {
            rowCount: 1,
            rows: [{
              blocking_resolution: 'rejected',
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('work_item_id = $3')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new PlaybookWorkflowControlService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      stateService: { recomputeWorkflowState: vi.fn(async () => 'active') } as never,
      activationService: { enqueueForWorkflow: vi.fn() } as never,
      activationDispatchService: { dispatchActivation: vi.fn() } as never,
    });

    await expect(service.completeWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-implementation-1',
      {},
      pool as never,
    )).rejects.toThrow(
      "Cannot complete work item 'Implement the reporting pipeline' while it still has a blocking rejected assessment.",
    );
  });
});
