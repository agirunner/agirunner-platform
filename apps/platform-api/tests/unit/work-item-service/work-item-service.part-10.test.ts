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
  it('does not stamp approval continuity on a new human-gate work item when the stage gate is already approved', async () => {
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
                  roles: ['writer'],
                  lifecycle: 'planned',
                  board: {
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                    entry_column_id: 'planned',
                  },
                  stages: [
                    { name: 'drafting', goal: 'Draft content' },
                    { name: 'approval-gate', goal: 'Human approval gate', involves: [] },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-drafting-1']);
          return {
            rows: [
              {
                id: 'wi-drafting-1',
                title: 'Draft package',
                stage_name: 'drafting',
                column_id: 'planned',
                completed_at: null,
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: 'full',
                latest_handoff_resolution: null,
                next_expected_actor: null,
                next_expected_action: null,
                blocked_state: null,
                blocked_reason: null,
                escalation_status: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT COUNT(*)::int AS count') && sql.includes('FROM workflow_work_items')) {
          return { rows: [{ count: 0 }], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id = $3') && sql.includes('FOR UPDATE')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT state, COUNT(*)::int AS count') && sql.includes('GROUP BY state')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM tasks') && sql.includes("state NOT IN ('completed', 'failed', 'cancelled')")) {
          return { rows: [{ count: 0 }], rowCount: 1 };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'approval-gate']);
          return {
            rows: [{ gate_status: 'approved' }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          expect(params?.[10]).toBeNull();
          expect(params?.[11]).toBeNull();
          return {
            rows: [
              {
                id: 'wi-approval-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: 'wi-drafting-1',
                stage_name: 'approval-gate',
                title: 'Human approval gate',
                goal: null,
                acceptance_criteria: null,
                column_id: 'planned',
                owner_role: null,
                next_expected_actor: null,
                next_expected_action: null,
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
        if (sql.includes('UPDATE workflow_work_items') && sql.includes("metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state'")) {
          return { rows: [{ id: 'wi-drafting-1' }], rowCount: 1 };
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
        request_id: 'req-approval-gate-approved-1',
        parent_work_item_id: 'wi-drafting-1',
        stage_name: 'approval-gate',
        title: 'Human approval gate',
      },
    );

    expect(workItem).toMatchObject({
      id: 'wi-approval-1',
      next_expected_actor: null,
      next_expected_action: null,
    });
  });

  it('returns blocked work-item posture in the read model', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [
          {
            id: 'wi-1',
            workflow_id: 'wf-1',
            parent_work_item_id: null,
            stage_name: 'policy',
            column_id: 'active',
            owner_role: 'writer',
            next_expected_actor: null,
            next_expected_action: null,
            blocked_state: 'blocked',
            blocked_reason: 'Policy review blocked release until trademark clearance is attached.',
            rework_count: 1,
            latest_handoff_completion: 'full',
            task_count: 1,
            children_count: 0,
            children_completed: 0,
            completed_at: null,
            gate_status: 'blocked',
            gate_decision_feedback: 'Trademark clearance is still missing.',
            gate_decided_at: new Date('2026-03-16T16:31:49.959Z'),
          },
        ],
      })),
    };

    const service = new WorkItemService(pool as never, {} as never, {} as never, {} as never);

    const workItem = await service.getWorkflowWorkItem('tenant-1', 'wf-1', 'wi-1');

    expect(workItem).toMatchObject({
      id: 'wi-1',
      blocked_state: 'blocked',
      blocked_reason: 'Policy review blocked release until trademark clearance is attached.',
      gate_status: 'blocked',
    });
  });

  it('returns escalation posture in the read model', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [
          {
            id: 'wi-1',
            workflow_id: 'wf-1',
            parent_work_item_id: null,
            stage_name: 'security',
            column_id: 'active',
            owner_role: 'writer',
            next_expected_actor: null,
            next_expected_action: null,
            blocked_state: null,
            blocked_reason: null,
            escalation_status: 'open',
            rework_count: 0,
            latest_handoff_completion: 'full',
            task_count: 1,
            children_count: 0,
            children_completed: 0,
            completed_at: null,
            gate_status: null,
            gate_decision_feedback: null,
            gate_decided_at: null,
          },
        ],
      })),
    };

    const service = new WorkItemService(pool as never, {} as never, {} as never, {} as never);

    const workItem = await service.getWorkflowWorkItem('tenant-1', 'wf-1', 'wi-1');

    expect(workItem).toMatchObject({
      id: 'wi-1',
      escalation_status: 'open',
    });
  });

  it('suppresses forward-looking continuity details for completed work items', async () => {
    const completedAt = new Date('2026-03-16T16:31:49.959Z');
    const pool = {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [
          {
            id: 'wi-1',
            workflow_id: 'wf-1',
            parent_work_item_id: null,
            stage_name: 'release',
            column_id: 'done',
            owner_role: 'product-manager',
            next_expected_actor: 'human',
            next_expected_action: 'approve',
            rework_count: 2,
            latest_handoff_completion: 'full',
            unresolved_findings: ['Release package is blocked until the CLI deliverable exists.'],
            focus_areas: ['Release deliverable must match approved CLI scope.'],
            known_risks: ['Release package is blocked until the CLI deliverable exists.'],
            task_count: 1,
            children_count: 0,
            children_completed: 0,
            completed_at: completedAt,
            gate_status: 'approved',
            gate_decision_feedback: 'Looks good.',
            gate_decided_at: completedAt,
          },
        ],
      })),
    };

    const service = new WorkItemService(pool as never, {} as never, {} as never, {} as never);

    const workItem = await service.getWorkflowWorkItem('tenant-1', 'wf-1', 'wi-1');

    expect(workItem).toMatchObject({
      id: 'wi-1',
      column_id: 'done',
      completed_at: completedAt,
      next_expected_actor: null,
      next_expected_action: null,
      unresolved_findings: [],
      focus_areas: [],
    });
    expect(workItem.known_risks).toEqual(['Release package is blocked until the CLI deliverable exists.']);
  });
});
