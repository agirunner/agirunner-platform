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
  it('rejects the immediate successor when the predecessor output is still pending required assessment', async () => {
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
                active_stage_name: 'implementation',
                lifecycle: 'planned',
                definition: {
                  roles: ['developer', 'reviewer', 'product-manager'],
                  lifecycle: 'planned',
                  board: {
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [
                    { name: 'implementation', goal: 'Ship the change' },
                    { name: 'review', goal: 'Review the implementation' },
                    { name: 'release', goal: 'Release the change' },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'review']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-impl-1']);
          return {
            rows: [
              {
                id: 'wi-impl-1',
                title: 'Implementation checkpoint',
                stage_name: 'implementation',
                column_id: 'planned',
                completed_at: null,
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: 'full',
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('GROUP BY state')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-impl-1']);
          return {
            rows: [{ state: 'output_pending_assessment', count: 1 }],
            rowCount: 1,
          };
        }
        if (
          sql.includes('FROM workflow_work_items')
          && sql.includes('parent_work_item_id = $3')
          && sql.includes('stage_name = $4')
          && sql.includes('completed_at IS NULL')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-impl-1', 'review', null]);
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM tasks') && sql.includes("state NOT IN ('completed', 'failed', 'cancelled')")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-impl-1']);
          return { rows: [{ count: 1 }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          throw new Error('successor work item insert should not run while required assessment is still pending');
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
          request_id: 'req-review-1',
          parent_work_item_id: 'wi-impl-1',
          stage_name: 'review',
          title: 'Review checkpoint',
        },
      ),
    ).rejects.toThrow(
      "Cannot create successor work item in stage 'review' while predecessor 'Implementation checkpoint' (implementation) still has non-terminal tasks. Wait for the current stage work item to finish before routing to the next stage.",
    );
  });

  it('rejects planned successor work-item creation while a required handoff is still pending', async () => {
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
                  roles: ['rework-product-strategist', 'rework-technical-editor', 'launch-planner'],
                  lifecycle: 'planned',
                  board: {
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [
                    {
                      name: 'drafting',
                      goal: 'Draft the brief',
                      involves: ['rework-product-strategist', 'rework-technical-editor'],
                    },
                    { name: 'approval-gate', goal: 'Human review gate' },
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
                title: 'Draft review-ready product brief',
                stage_name: 'drafting',
                column_id: 'planned',
                completed_at: null,
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: 'full',
                latest_handoff_resolution: null,
                next_expected_actor: 'rework-technical-editor',
                next_expected_action: 'handoff',
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'approval-gate']);
          return {
            rows: [{ gate_status: 'not_requested' }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          throw new Error('successor work item insert should not run while required handoff is still pending');
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
          request_id: 'req-gate-1',
          parent_work_item_id: 'wi-drafting-1',
          stage_name: 'approval-gate',
          title: 'Human review gate for revised requirements brief',
        },
      ),
    ).rejects.toThrow(
      "Cannot create successor work item in stage 'approval-gate' while predecessor 'Draft review-ready product brief' (drafting) still requires handoff by 'rework-technical-editor'.",
    );
  });

  it('rejects planned successor work-item creation when it skips the immediate next checkpoint', async () => {
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
                active_stage_name: 'implementation',
                lifecycle: 'planned',
                definition: {
                  roles: ['developer', 'reviewer', 'product-manager'],
                  lifecycle: 'planned',
                  board: { columns: [{ id: 'planned', label: 'Planned' }, { id: 'done', label: 'Done', is_terminal: true }] },
                  stages: [
                    { name: 'implementation', goal: 'Ship the change' },
                    { name: 'review', goal: 'Review the implementation' },
                    { name: 'release', goal: 'Release the change' },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'release']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-impl-1']);
          return {
            rows: [
              {
                id: 'wi-impl-1',
                title: 'Implementation checkpoint',
                stage_name: 'implementation',
                column_id: 'planned',
                completed_at: null,
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: 'full',
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks')) {
          throw new Error('skip-stage validation should fail before task-state inspection');
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          throw new Error('skipped successor checkpoint insert must be rejected');
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
          request_id: 'req-release-1',
          parent_work_item_id: 'wi-impl-1',
          stage_name: 'release',
          title: 'Release checkpoint',
        },
      ),
    ).rejects.toThrowError(ValidationError);
  });
});
