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
  it('rejects planned successor work-item creation while the predecessor still has a pending task', async () => {
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
                active_stage_name: 'requirements',
                lifecycle: 'planned',
                definition: {
                  roles: ['product-manager', 'architect'],
                  lifecycle: 'planned',
                  board: { columns: [{ id: 'planned', label: 'Planned' }, { id: 'done', label: 'Done', is_terminal: true }] },
                  stages: [
                    { name: 'requirements', goal: 'Define scope' },
                    { name: 'design', goal: 'Design the solution' },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'design']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-req-1']);
          return {
            rows: [
              {
                id: 'wi-req-1',
                title: 'Requirements checkpoint',
                stage_name: 'requirements',
                completed_at: null,
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes("state NOT IN ('completed', 'failed', 'cancelled')")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-req-1']);
          return { rows: [{ count: 1 }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          throw new Error('successor work item insert should not run while predecessor task is pending');
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
          request_id: 'req-next-1',
          parent_work_item_id: 'wi-req-1',
          stage_name: 'design',
          title: 'Design checkpoint',
        },
      ),
    ).rejects.toThrowError(ValidationError);
  });

  it('rejects planned successor work-item creation until the predecessor has a full handoff', async () => {
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
                active_stage_name: 'requirements',
                lifecycle: 'planned',
                definition: {
                  roles: ['product-manager', 'architect'],
                  lifecycle: 'planned',
                  board: { columns: [{ id: 'planned', label: 'Planned' }, { id: 'done', label: 'Done', is_terminal: true }] },
                  stages: [
                    { name: 'requirements', goal: 'Define scope' },
                    { name: 'design', goal: 'Design the solution' },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'design']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-req-1']);
          return {
            rows: [
              {
                id: 'wi-req-1',
                title: 'Requirements checkpoint',
                stage_name: 'requirements',
                completed_at: null,
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes("state NOT IN ('completed', 'failed', 'cancelled')")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-req-1']);
          return { rows: [{ count: 0 }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          throw new Error('successor work item insert should not run before a full predecessor handoff exists');
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
          request_id: 'req-next-1',
          parent_work_item_id: 'wi-req-1',
          stage_name: 'design',
          title: 'Design checkpoint',
        },
      ),
    ).rejects.toThrowError(ValidationError);
  });

  it('rejects planned successor work-item creation when the predecessor full handoff requests changes', async () => {
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
                active_stage_name: 'review',
                lifecycle: 'planned',
                definition: {
                  roles: ['developer', 'reviewer', 'qa'],
                  lifecycle: 'planned',
                  board: { columns: [{ id: 'planned', label: 'Planned' }, { id: 'done', label: 'Done', is_terminal: true }] },
                  stages: [
                    { name: 'implementation', goal: 'Ship the change' },
                    { name: 'review', goal: 'Review the implementation' },
                    { name: 'verification', goal: 'Verify the change' },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'verification']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-review-1']);
          return {
            rows: [
              {
                id: 'wi-review-1',
                title: 'Review checkpoint',
                stage_name: 'review',
                completed_at: null,
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: 'full',
                latest_handoff_resolution: 'request_changes',
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes("state NOT IN ('completed', 'failed', 'cancelled')")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-review-1']);
          return { rows: [{ count: 0 }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          throw new Error('successor work item insert should not run while predecessor handoff requests changes');
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
          request_id: 'req-next-1',
          parent_work_item_id: 'wi-review-1',
          stage_name: 'verification',
          title: 'Verification checkpoint',
        },
      ),
    ).rejects.toThrowError(ValidationError);
  });

  it('allows planned successor work-item creation after an approved human gate even without a gate-stage handoff', async () => {
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
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
                active_stage_name: 'approval-gate',
                lifecycle: 'planned',
                definition: {
                  roles: ['writer', 'publisher'],
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
                    { name: 'approval-gate', goal: 'Record human decision', involves: [] },
                    { name: 'publication', goal: 'Publish content' },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'publication']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-gate-1']);
          return {
            rows: [
              {
                id: 'wi-gate-1',
                title: 'Human approval gate',
                stage_name: 'approval-gate',
                column_id: 'planned',
                completed_at: null,
                human_gate: true,
                gate_status: 'approved',
                latest_handoff_completion: null,
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-gate-1']);
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM tasks') && sql.includes("state NOT IN ('completed', 'failed', 'cancelled')")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-gate-1']);
          return { rows: [{ count: 0 }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          return {
            rows: [
              {
                id: 'wi-publish-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: 'wi-gate-1',
                stage_name: 'publication',
                title: 'Publication checkpoint',
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
                created_at: '2026-03-24T00:36:00.000Z',
                updated_at: '2026-03-24T00:36:00.000Z',
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('UPDATE workflow_stages')) {
          return { rows: [{ id: 'stage-publication-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_stages')) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkItemService(
      { connect: vi.fn().mockResolvedValue(client) } as never,
      eventService as never,
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
        request_id: 'req-publication-1',
        parent_work_item_id: 'wi-gate-1',
        stage_name: 'publication',
        title: 'Publication checkpoint',
      },
    );

    expect(workItem).toMatchObject({
      id: 'wi-publish-1',
      stage_name: 'publication',
      parent_work_item_id: 'wi-gate-1',
    });
  });
});
