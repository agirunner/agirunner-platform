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

  it('allows completing a work item when a later approved assessment supersedes an older request-changes verdict for the same role and subject', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-12b' })),
    };
    const dispatchService = {
      dispatchActivation: vi.fn(async () => 'task-12b'),
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
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 1,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: {},
              updated_at: new Date('2026-03-11T03:00:00Z'),
            }],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          expect(sql).toContain('SELECT DISTINCT ON (th.role)');
          expect(sql).toContain("th.resolution IN ('approved', 'request_changes', 'rejected', 'blocked')");
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
              rework_count: 1,
              priority: 'high',
              notes: null,
              completed_at: new Date('2026-03-11T03:00:30Z'),
              metadata: {},
              completion_callouts: {
                residual_risks: [],
                unresolved_advisory_items: [],
                waived_steps: [],
                completion_notes: null,
              },
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
  });


  it('reconciles workflow deliverable rollups when a work item completes', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-rollup' })),
    };
    const dispatchService = {
      dispatchActivation: vi.fn(async () => 'task-rollup'),
    };
    const stateService = {
      recomputeWorkflowState: vi.fn(async () => 'active'),
    };
    const workflowDeliverableService = {
      reconcileWorkflowRollupsForCompletedWorkItem: vi.fn(async () => undefined),
    };
    const updatedAt = new Date('2026-03-11T03:05:30Z');
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
              id: 'wi-implementation-rollup',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Implement the reporting pipeline',
              goal: 'Ship the feature',
              acceptance_criteria: 'The reporting pipeline is complete.',
              column_id: 'planned',
              owner_role: 'implementer',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 1,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: {},
              updated_at: new Date('2026-03-11T03:00:00Z'),
            }],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          return {
            rowCount: 0,
            rows: [],
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-implementation-rollup',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Implement the reporting pipeline',
              goal: 'Ship the feature',
              acceptance_criteria: 'The reporting pipeline is complete.',
              column_id: 'done',
              owner_role: 'implementer',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 1,
              priority: 'high',
              notes: null,
              completed_at: new Date('2026-03-11T03:05:30Z'),
              metadata: {},
              completion_callouts: {
                residual_risks: [],
                unresolved_advisory_items: [],
                waived_steps: [],
                completion_notes: null,
              },
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
      workflowDeliverableService: workflowDeliverableService as never,
    } as never);

    await service.completeWorkItem(
      { tenantId: 'tenant-1', scope: 'admin', ownerType: 'user', ownerId: 'user-1', keyPrefix: 'k1', id: 'key-1' },
      'workflow-1',
      'wi-implementation-rollup',
      {},
      pool as never,
    );

    expect(workflowDeliverableService.reconcileWorkflowRollupsForCompletedWorkItem).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      'wi-implementation-rollup',
      pool,
    );
  });


  it('rejects completing a work item while a required assessment is still pending', async () => {
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
              next_expected_actor: 'release-assessor',
              next_expected_action: 'assess',
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: {},
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
      "Cannot complete work item 'Implement the reporting pipeline' while required assessment by 'release-assessor' is still pending.",
    );
  });


  it('rejects completing a work item while a required handoff is still pending', async () => {
    const definitionWithDrafting = {
      ...definition,
      stages: [
        {
          name: 'drafting',
          goal: 'Draft a review-ready packet.',
          involves: ['rework-product-strategist', 'rework-technical-editor'],
        },
      ],
    };
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              workspace_id: 'workspace-1',
              playbook_id: 'playbook-1',
              lifecycle: 'planned',
              active_stage_name: 'drafting',
              state: 'active',
              definition: definitionWithDrafting,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-drafting-1',
              parent_work_item_id: null,
              stage_name: 'drafting',
              title: 'Draft review-ready product brief',
              goal: 'Prepare the packet',
              acceptance_criteria: 'A review-ready packet exists.',
              column_id: 'planned',
              owner_role: 'rework-product-strategist',
              next_expected_actor: 'rework-technical-editor',
              next_expected_action: 'handoff',
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: {},
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
      'wi-drafting-1',
      {},
      pool as never,
    )).rejects.toThrow(
      "Cannot complete work item 'Draft review-ready product brief' while required handoff by 'rework-technical-editor' is still pending.",
    );
  });
});
