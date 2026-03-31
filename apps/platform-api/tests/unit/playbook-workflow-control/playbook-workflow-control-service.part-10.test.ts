import { describe, expect, it, vi } from 'vitest';

import { ConflictError, ValidationError } from '../../../src/errors/domain-errors.js';
import { PlaybookWorkflowControlService } from '../../../src/services/playbook-workflow-control-service.js';

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

  it('allows completing a work item when no blocking assessment exists', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-12' })),
    };
    const dispatchService = {
      dispatchActivation: vi.fn(async () => 'task-12'),
    };
    const stateService = {
      recomputeWorkflowState: vi.fn(async () => 'active'),
    };
    const updatedAt = new Date('2026-03-11T03:00:30Z');
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
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
              next_expected_actor: 'implementer',
              next_expected_action: 'finish_delivery',
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: { orchestrator_finish_state: 'pending' },
              updated_at: new Date('2026-03-11T03:00:00Z'),
            }],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          expect(sql).toContain('th.work_item_id = $3');
          expect(sql).not.toContain('th.work_item_id = $4');
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-implementation-1']);
          return {
            rowCount: 0,
            rows: [],
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-implementation-1',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Implement the reporting pipeline',
              goal: 'Ship the feature',
              acceptance_criteria: 'The reporting pipeline is complete.',
              column_id: 'done',
              owner_role: 'implementer',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: new Date('2026-03-11T03:00:30Z'),
              metadata: {},
              updated_at: updatedAt,
            }],
          };
        }
        if (sql.includes('SELECT stage_name, status, gate_status, human_gate') || sql.includes('FROM workflow_stages')) {
          return {
            rowCount: 0,
            rows: [],
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
      'wi-implementation-1',
      {},
      pool as never,
    );

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'wi-implementation-1',
        column_id: 'done',
        completed_at: '2026-03-11T03:00:30.000Z',
      }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.completed',
        entityType: 'work_item',
        entityId: 'wi-implementation-1',
      }),
      pool,
    );
  });


  it('clears forward-looking continuity and finish-state metadata when completing a work item', async () => {
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
    const updatedAt = new Date('2026-03-11T02:00:30Z');
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
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
              next_expected_actor: 'live-test-intake-analyst',
              next_expected_action: 'Complete task and submit a triage handoff',
              rework_count: 0,
              priority: 'normal',
              notes: null,
              completed_at: null,
              metadata: {
                lane: 'default',
                orchestrator_finish_state: {
                  status_summary: 'Waiting for analyst handoff',
                  next_expected_event: 'task.handoff_submitted',
                },
              },
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          expect(sql).toContain('next_expected_actor');
          expect(sql).toContain('next_expected_action');
          expect(sql).toContain('metadata');
          expect(params).toEqual(
            expect.arrayContaining([
              null,
              {
                lane: 'default',
              },
            ]),
          );
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
              metadata: {
                lane: 'default',
              },
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

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'wi-ongoing-1',
        column_id: 'done',
        next_expected_actor: null,
        next_expected_action: null,
        metadata: {
          lane: 'default',
        },
      }),
    );
  });


  it('rejects reparenting a work item under one of its descendants', async () => {
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
              metadata: {},
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('WITH RECURSIVE descendants')) {
          return { rowCount: 1, rows: [{ id: 'wi-3' }] };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('LIMIT 1') && !sql.includes('FOR UPDATE')) {
          return { rowCount: 1, rows: [{ id: 'wi-3' }] };
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

    await expect(
      service.updateWorkItem(
        { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
        'workflow-1',
        'wi-2',
        { parent_work_item_id: 'wi-3' },
        pool as never,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
