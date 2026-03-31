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

  it('rejects completing a work item while a non-terminal task still exists for that work item', async () => {
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
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: {},
              updated_at: new Date('2026-03-11T00:00:00Z'),
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('work_item_id = $3')) {
          expect(sql).toContain('state::text <> ALL($4::text[])');
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-implementation-1', ['completed', 'failed', 'cancelled'], null]);
          return {
            rowCount: 1,
            rows: [{
              id: 'task-implementation-1',
              role: 'implementer',
              state: 'in_progress',
              stage_name: 'implementation',
            }],
          };
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
      "Cannot complete work item 'Implement the reporting pipeline' while task 'implementer' is still in_progress.",
    );
  });


  it('allows the calling orchestrator task to complete its own work item', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-14' })),
    };
    const dispatchService = {
      dispatchActivation: vi.fn(async () => 'task-14'),
    };
    const stateService = {
      recomputeWorkflowState: vi.fn(async () => 'active'),
    };
    const completedAt = new Date('2026-03-11T03:46:30Z');
    const updatedAt = new Date('2026-03-11T03:45:30Z');
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
              goal: 'Build the reporting workflow.',
              acceptance_criteria: 'Pipeline is production ready.',
              column_id: 'planned',
              owner_role: 'implementer',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: {},
              completion_callouts: {},
              updated_at: updatedAt,
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('work_item_id = $3')) {
          expect(sql).toContain('AND ($5::uuid IS NULL OR id <> $5::uuid)');
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'wi-implementation-1',
            ['completed', 'failed', 'cancelled'],
            'task-orchestrator-1',
          ]);
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('blocking_resolution')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-implementation-1',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Implement the reporting pipeline',
              goal: 'Build the reporting workflow.',
              acceptance_criteria: 'Pipeline is production ready.',
              column_id: 'done',
              owner_role: 'implementer',
              next_expected_actor: null,
              next_expected_action: null,
              blocked_state: null,
              blocked_reason: null,
              escalation_status: null,
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: completedAt,
              metadata: {},
              completion_callouts: {},
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
      'wi-implementation-1',
      { acting_task_id: 'task-orchestrator-1' },
      pool as never,
    );

    expect(updated).toEqual(expect.objectContaining({
      id: 'wi-implementation-1',
      column_id: 'done',
      completed_at: completedAt.toISOString(),
    }));
  });


  it('allows completing a work item when a required handoff continuity entry is stale', async () => {
    const definitionWithReleasePass = {
      ...definition,
      stages: [
        ...definition.stages,
        {
          name: 'release-pass',
          goal: 'Validate release readiness.',
          involves: ['integration-quality-assessor', 'revision-release-coordinator'],
        },
      ],
    };
    const eventService = { emit: vi.fn(async () => undefined) };
    const activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-13' })),
    };
    const dispatchService = {
      dispatchActivation: vi.fn(async () => 'task-13'),
    };
    const stateService = {
      recomputeWorkflowState: vi.fn(async () => 'active'),
    };
    const updatedAt = new Date('2026-03-11T03:15:30Z');
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
              active_stage_name: 'release-pass',
              state: 'active',
              definition: definitionWithReleasePass,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $3') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-release-1',
              parent_work_item_id: null,
              stage_name: 'release-pass',
              title: 'Assess release readiness',
              goal: 'Close the release gate',
              acceptance_criteria: 'Release handoffs are complete.',
              column_id: 'planned',
              owner_role: 'integration-quality-assessor',
              next_expected_actor: 'revision-release-coordinator',
              next_expected_action: 'handoff',
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: null,
              metadata: {
                subject_revision: 1,
              },
              updated_at: new Date('2026-03-11T03:15:00Z'),
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs th')
          && sql.includes("COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'")
          && sql.includes('AND th.role = $4')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-release-1', 'revision-release-coordinator', 1]);
          return {
            rowCount: 1,
            rows: [{ satisfied_handoff: 1 }],
          };
        }
        if (sql.includes('SELECT latest_assessment.resolution AS blocking_resolution')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'wi-release-1',
              parent_work_item_id: null,
              stage_name: 'release-pass',
              title: 'Assess release readiness',
              goal: 'Close the release gate',
              acceptance_criteria: 'Release handoffs are complete.',
              column_id: 'done',
              owner_role: 'integration-quality-assessor',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 'high',
              notes: null,
              completed_at: new Date('2026-03-11T03:15:30Z'),
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
      'wi-release-1',
      {},
      pool as never,
    );

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'wi-release-1',
        column_id: 'done',
        completed_at: '2026-03-11T03:15:30.000Z',
      }),
    );
  });
});
