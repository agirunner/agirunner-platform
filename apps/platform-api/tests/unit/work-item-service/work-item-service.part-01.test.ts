import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logSafetynetTriggeredMock } from './work-item-service-test-support.js';

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: logSafetynetTriggeredMock,
}));

import { ConflictError, ValidationError } from '../../../src/errors/domain-errors.js';
import { WorkItemService } from '../../../src/services/work-item-service/work-item-service.js';

const identity = {
  tenantId: 'tenant-1',
  scope: 'admin',
  keyPrefix: 'admin-key',
};

beforeEach(() => {
  logSafetynetTriggeredMock.mockReset();
});

describe('WorkItemService', () => {
  it('rejects creating a work item for a paused workflow', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              lifecycle: 'planned',
              state: 'paused',
              metadata: {},
              definition: {
                lifecycle: 'planned',
                board: {
                  columns: [{ id: 'planned', label: 'Planned' }],
                  entry_column_id: 'planned',
                },
                stages: [{ name: 'drafting', goal: 'Draft the brief' }],
                roles: [],
              },
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_stages ws')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkItemService(
      { connect: vi.fn(async () => client) } as never,
      { emit: vi.fn() } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.createWorkItem(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        'workflow-1',
        { title: 'Should not create while paused' },
      ),
    ).rejects.toThrow('Workflow is paused');
  });

  it('rejects creating a work item once workflow cancellation is in progress', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              lifecycle: 'planned',
              state: 'active',
              metadata: { cancel_requested_at: '2026-03-28T22:45:01.630Z' },
              definition: {
                lifecycle: 'planned',
                board: {
                  columns: [{ id: 'planned', label: 'Planned' }],
                  entry_column_id: 'planned',
                },
                stages: [{ name: 'drafting', goal: 'Draft the brief' }],
                roles: [],
              },
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_stages ws')) {
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkItemService(
      { connect: vi.fn(async () => client) } as never,
      { emit: vi.fn() } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.createWorkItem(
        {
          tenantId: 'tenant-1',
          scope: 'admin',
          keyPrefix: 'admin-key',
        } as never,
        'workflow-1',
        { title: 'Should not create while cancelling' },
      ),
    ).rejects.toThrow('Workflow cancellation is already in progress');
  });

  it('treats blocked assessment decisions as blocking in assessment rollups', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        expect(sql).toContain("IN ('request_changes', 'rejected', 'blocked')");
        expect(sql).toContain("IN ('approved', 'request_changes', 'rejected', 'blocked')");
        return {
          rowCount: 1,
          rows: [{
            id: 'work-item-1',
            workflow_id: 'workflow-1',
            parent_work_item_id: null,
            stage_name: 'draft-revision',
            column_id: 'blocked',
            owner_role: 'blocked-content-author',
            next_expected_actor: null,
            next_expected_action: null,
            blocked_state: 'blocked',
            blocked_reason: 'The draft is blocked pending source verification.',
            escalation_status: null,
            rework_count: 0,
            task_count: 1,
            children_count: 0,
            children_completed: 0,
            latest_handoff_completion: 'full',
            latest_handoff_resolution: 'blocked',
            unresolved_findings: [],
            focus_areas: [],
            known_risks: [],
            current_subject_revision: 1,
            approved_assessment_count: 0,
            blocking_assessment_count: 1,
            pending_assessment_count: 0,
            assessment_status: 'blocked',
            stage_gate_status: 'not_requested',
            gate_status: 'not_requested',
            gate_decision_feedback: null,
            gate_decided_at: null,
            branch_status: null,
            metadata: {},
            completed_at: null,
            created_at: '2026-03-24T00:00:00.000Z',
            updated_at: '2026-03-24T00:00:00.000Z',
          }],
        };
      }),
    };

    const service = new WorkItemService(pool as never, {} as never, {} as never, {} as never);
    const workItem = await service.getWorkflowWorkItem('tenant-1', 'workflow-1', 'work-item-1');

    expect(workItem).toMatchObject({
      id: 'work-item-1',
      assessment_status: 'blocked',
      blocking_assessment_count: 1,
    });
  });

  it('seeds approval continuity when the persisted stage gate is awaiting approval', async () => {
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
                active_stage_name: 'drafting',
                lifecycle: 'planned',
                definition: {
                  roles: ['product-strategist', 'launch-planner'],
                  lifecycle: 'planned',
                  board: {
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                    entry_column_id: 'planned',
                  },
                  stages: [
                    { name: 'drafting', goal: 'Draft the brief' },
                    { name: 'approval-gate', goal: 'Record a human decision', involves: [] },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT COUNT(*)::int AS count') && sql.includes('FROM workflow_work_items')) {
          return { rows: [{ count: 0 }], rowCount: 1 };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'approval-gate']);
          return { rows: [{ gate_status: 'awaiting_approval' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          expect(params?.[10]).toBe('human');
          expect(params?.[11]).toBe('approve');
          return {
            rows: [
              {
                id: 'wi-approval-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'approval-gate',
                title: 'Human review gate',
                goal: null,
                acceptance_criteria: null,
                column_id: 'planned',
                owner_role: null,
                next_expected_actor: 'human',
                next_expected_action: 'approve',
                rework_count: 0,
                priority: 'normal',
                notes: null,
                completed_at: null,
                metadata: {},
                created_at: '2026-03-23T00:00:00.000Z',
                updated_at: '2026-03-23T00:00:00.000Z',
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('UPDATE workflow_stages')) {
          return { rows: [{ id: 'stage-approval-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_stages')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflow_work_items wi') || sql.includes('FROM tasks')) {
          return { rows: [{ count: 0 }], rowCount: 1 };
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

    const workItem = await service.createWorkItem(
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
        request_id: 'req-approval-gate-1',
        stage_name: 'approval-gate',
        title: 'Human review gate',
      },
    );

    expect(workItem).toMatchObject({
      id: 'wi-approval-1',
      next_expected_actor: 'human',
      next_expected_action: 'approve',
    });
  });
});
