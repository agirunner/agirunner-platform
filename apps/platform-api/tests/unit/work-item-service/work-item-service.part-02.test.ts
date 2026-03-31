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
  it('allows seeding the first planned stage work item with any role involved in that stage', async () => {
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
                active_stage_name: 'briefing',
                lifecycle: 'planned',
                definition: {
                  roles: ['market-researcher', 'managing-editor'],
                  lifecycle: 'planned',
                  board: {
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [
                    {
                      name: 'briefing',
                      goal: 'Produce the publication brief',
                      involves: ['market-researcher', 'managing-editor'],
                    },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'briefing']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
        }
        if (sql.includes('SELECT COUNT(*)::int AS count') && sql.includes('FROM workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'briefing']);
          return { rows: [{ count: 0 }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          expect(params?.[9]).toBe('managing-editor');
          return {
            rows: [
              {
                id: 'wi-briefing-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'briefing',
                title: 'Publish-ready brief from research memo',
                goal: null,
                acceptance_criteria: null,
                column_id: 'planned',
                owner_role: 'managing-editor',
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
        if (sql.includes('UPDATE workflow_stages')) {
          return { rows: [{ id: 'stage-briefing-1' }], rowCount: 1 };
        }
        if (sql.includes('SELECT ws.id,') && sql.includes('FROM workflow_stages ws')) {
          return {
            rows: [
              {
                id: 'stage-briefing-1',
                lifecycle: 'planned',
                name: 'briefing',
                position: 0,
                goal: 'Produce the publication brief',
                guidance: null,
                human_gate: false,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: new Date('2026-03-23T00:00:00.000Z'),
                completed_at: null,
                open_work_item_count: 1,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-23T00:00:00.000Z'),
                last_completed_work_item_at: null,
              },
            ],
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
        request_id: 'req-briefing-seed-1',
        stage_name: 'briefing',
        title: 'Publish-ready brief from research memo',
        owner_role: 'managing-editor',
      },
    );

    expect(workItem).toMatchObject({
      id: 'wi-briefing-1',
      owner_role: 'managing-editor',
      stage_name: 'briefing',
    });
  });

  it('creates and assigns an explicit branch when a work item declares branch_key', async () => {
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
                active_stage_name: 'variant-draft',
                lifecycle: 'ongoing',
                definition: {
                  roles: ['branch-copywriter'],
                  lifecycle: 'ongoing',
                  board: {
                    columns: [{ id: 'planned', label: 'Planned' }],
                    entry_column_id: 'planned',
                  },
                  stages: [{ name: 'variant-draft', goal: 'Draft each branch variant.' }],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'variant-draft']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_branches') && sql.includes('branch_key = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'deprecated-release']);
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO workflow_branches')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            null,
            { kind: 'workflow', workflow_id: 'workflow-1' },
            'deprecated-release',
            'stop_branch_only',
            null,
            {},
          ]);
          return {
            rows: [{ id: 'branch-1' }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          expect(sql).toContain('branch_id');
          expect(params?.[17]).toBe('branch-1');
          return {
            rows: [
              {
                id: 'work-item-branch-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                branch_id: 'branch-1',
                branch_status: 'active',
                stage_name: 'variant-draft',
                title: 'Draft deprecated release branch',
                goal: 'Draft the deprecated release variant.',
                acceptance_criteria: 'Variant draft exists.',
                column_id: 'planned',
                owner_role: 'branch-copywriter',
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                priority: 'normal',
                notes: null,
                blocked_state: null,
                blocked_reason: null,
                escalation_status: null,
                completed_at: null,
                metadata: {},
                created_at: '2026-03-23T00:00:00.000Z',
                updated_at: '2026-03-23T00:00:00.000Z',
                task_count: 0,
                children_count: 0,
                is_milestone: false,
              },
            ],
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
        request_id: 'req-branch-1',
        stage_name: 'variant-draft',
        title: 'Draft deprecated release branch',
        goal: 'Draft the deprecated release variant.',
        acceptance_criteria: 'Variant draft exists.',
        owner_role: 'branch-copywriter',
        branch_key: 'deprecated-release',
      },
    );

    expect(workItem).toMatchObject({
      id: 'work-item-branch-1',
      branch_id: 'branch-1',
      branch_status: 'active',
    });
  });

  it('creates a branch when branch_key is supplied without authored branch policy', async () => {
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
                active_stage_name: 'variant-draft',
                lifecycle: 'ongoing',
                definition: {
                  roles: ['branch-copywriter'],
                  lifecycle: 'ongoing',
                  board: {
                    columns: [{ id: 'planned', label: 'Planned' }],
                  },
                  stages: [{ name: 'variant-draft', goal: 'Draft each branch variant.' }],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'variant-draft']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_branches') && sql.includes('branch_key = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'deprecated-release']);
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO workflow_branches')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            null,
            { kind: 'workflow', workflow_id: 'workflow-1' },
            'deprecated-release',
            'stop_branch_only',
            null,
            {},
          ]);
          return { rows: [{ id: 'branch-1' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          expect(params?.[17]).toBe('branch-1');
          return {
            rows: [
              {
                id: 'work-item-branch-1',
                workflow_id: 'workflow-1',
                request_id: 'req-branch-1',
                parent_work_item_id: null,
                branch_id: 'branch-1',
                branch_status: 'active',
                stage_name: 'variant-draft',
                title: 'Draft deprecated release branch',
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
                created_at: '2026-03-23T00:00:00.000Z',
                updated_at: '2026-03-23T00:00:00.000Z',
              },
            ],
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
        request_id: 'req-branch-1',
        stage_name: 'variant-draft',
        title: 'Draft deprecated release branch',
        branch_key: 'deprecated-release',
      },
    );

    expect(workItem).toMatchObject({
      id: 'work-item-branch-1',
      branch_id: 'branch-1',
    });
  });
});
