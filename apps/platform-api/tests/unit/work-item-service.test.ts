import { describe, expect, it, vi } from 'vitest';

const { logSafetynetTriggeredMock } = vi.hoisted(() => ({
  logSafetynetTriggeredMock: vi.fn(),
}));

vi.mock('../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: logSafetynetTriggeredMock,
}));

import { ConflictError, ValidationError } from '../../src/errors/domain-errors.js';
import { WorkItemService } from '../../src/services/work-item-service.js';

describe('WorkItemService', () => {
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

  it('allows planned successor work-item creation when approval continuity is stale but the human gate is approved', async () => {
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
                next_expected_actor: 'human',
                next_expected_action: 'approve',
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
        request_id: 'req-publication-2',
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

  it('summarizes actual assessments against the current subject revision without playbook rules', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          expect(sql).toContain('latest_delivery.subject_revision AS current_subject_revision');
          expect(sql).toContain("COALESCE(NULLIF(assessment_task.metadata->>'subject_revision', '')::int, -1) = COALESCE(latest_delivery.subject_revision, -1)");
          expect(sql).toContain("COALESCE(assessment_task.metadata->>'task_kind', '') = 'assessment'");
          expect(sql).toContain('approved_assessment_count');
          expect(sql).toContain('blocking_assessment_count');
          expect(sql).toContain('pending_assessment_count');
          expect(sql).toContain('assessment_status');
          expect(sql).not.toContain('assessment_rules');
          expect(sql).not.toContain('required_assessment_count');
          expect(sql).not.toContain('retained_assessment_count');
          expect(sql).not.toContain('invalidated_assessment_count');
          return {
            rows: [
              {
                id: 'wi-impl-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'implementation',
                title: 'Implementation checkpoint',
                column_id: 'planned',
                task_count: '1',
                children_count: '0',
                children_completed: '0',
                current_subject_revision: 2,
                approved_assessment_count: 0,
                blocking_assessment_count: 0,
                pending_assessment_count: 1,
                assessment_status: 'pending',
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

    expect((workItem as Record<string, unknown>).current_subject_revision).toBe(2);
    expect((workItem as Record<string, unknown>).approved_assessment_count).toBe(0);
    expect((workItem as Record<string, unknown>).blocking_assessment_count).toBe(0);
    expect((workItem as Record<string, unknown>).pending_assessment_count).toBe(1);
    expect((workItem as Record<string, unknown>).assessment_status).toBe('pending');
  });

  it('does not expose revision-retention assessment counters in prose-governed reads', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          expect(sql).not.toContain('retained_assessment_count');
          expect(sql).not.toContain('invalidated_assessment_count');
          expect(sql).not.toContain("revision_policy->>'assessment_retention'");
          expect(sql).not.toContain('materiality text');
          return {
            rows: [
              {
                id: 'wi-review-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'review',
                title: 'Editorial review',
                column_id: 'planned',
                task_count: '1',
                children_count: '0',
                children_completed: '0',
                current_subject_revision: 3,
                approved_assessment_count: 1,
                blocking_assessment_count: 0,
                pending_assessment_count: 1,
                assessment_status: 'pending',
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

    expect((workItem as Record<string, unknown>).retained_assessment_count).toBeUndefined();
    expect((workItem as Record<string, unknown>).invalidated_assessment_count).toBeUndefined();
    expect((workItem as Record<string, unknown>).assessment_status).toBe('pending');
  });

  it('compares nullable delivery subject task ids without coercing uuids to empty strings', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          expect(sql).toContain("COALESCE(assessment_task.metadata->>'subject_task_id', '')");
          expect(sql).toContain("COALESCE(latest_delivery.subject_task_id::text, '')");
          expect(sql).not.toContain("COALESCE(latest_delivery.subject_task_id, '')");
          return {
            rows: [
              {
                id: 'wi-blueprint-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'blueprint',
                title: 'Blueprint checkpoint',
                column_id: 'planned',
                task_count: '0',
                children_count: '0',
                children_completed: '0',
                current_subject_revision: null,
                approved_assessment_count: 0,
                blocking_assessment_count: 0,
                pending_assessment_count: 0,
                assessment_status: null,
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

    expect((workItem as Record<string, unknown>).stage_name).toBe('blueprint');
    expect((workItem as Record<string, unknown>).assessment_status).toBeNull();
  });

  it('surfaces branch posture on workflow work item reads', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          expect(sql).toContain('wi.branch_id');
          expect(sql).toContain('workflow_branches');
          expect(sql).toContain('branch_status');
          return {
            rows: [
              {
                id: 'wi-branch-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                branch_id: 'branch-1',
                branch_status: 'active',
                stage_name: 'publication',
                title: 'Deprecated release branch',
                column_id: 'planned',
                task_count: '0',
                children_count: '0',
                children_completed: '0',
                current_subject_revision: null,
                approved_assessment_count: 0,
                blocking_assessment_count: 0,
                pending_assessment_count: 0,
                assessment_status: null,
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

    expect((workItem as Record<string, unknown>).branch_id).toBe('branch-1');
    expect((workItem as Record<string, unknown>).branch_status).toBe('active');
  });

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
      "Cannot create successor work item in stage 'review' while predecessor 'Implementation checkpoint' (implementation) still has non-terminal tasks. Wait for the current checkpoint task to finish before routing to the next stage.",
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

  it('reuses an open planned child checkpoint in the same stage after rework instead of inserting a duplicate', async () => {
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
                active_stage_name: 'review',
                lifecycle: 'planned',
                definition: {
                  roles: ['developer', 'reviewer', 'qa'],
                  lifecycle: 'planned',
                  board: {
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [
                    { name: 'implementation', goal: 'Ship the change' },
                    { name: 'review', goal: 'Review the change' },
                    { name: 'verification', goal: 'Verify the change' },
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
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation-item']);
          return {
            rows: [
              {
                id: 'implementation-item',
                title: 'Implementation checkpoint',
                stage_name: 'implementation',
                column_id: 'done',
                completed_at: new Date('2026-03-21T04:00:00Z'),
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: 'full',
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.startsWith('SELECT COUNT(*)::int AS count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation-item']);
          return {
            rows: [{ count: 0 }],
            rowCount: 1,
          };
        }
        if (
          sql.includes('FROM workflow_work_items')
          && sql.includes('parent_work_item_id = $3')
          && sql.includes('stage_name = $4')
          && sql.includes('completed_at IS NULL')
        ) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'implementation-item',
            'review',
            'reviewer',
          ]);
          return {
            rows: [
              {
                id: 'review-item-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: 'implementation-item',
                request_id: 'req-review-1',
                stage_name: 'review',
                title: 'Review checkpoint',
                goal: 'Review the implementation',
                acceptance_criteria: 'Review and approve the change.',
                column_id: 'planned',
                owner_role: 'reviewer',
                next_expected_actor: 'developer',
                next_expected_action: 'rework',
                rework_count: 0,
                priority: 'normal',
                notes: 'Open review item awaiting resubmission',
                created_by: 'system',
                metadata: {
                  orchestrator_finish_state: {
                    next_expected_actor: 'developer',
                    next_expected_action: 'rework',
                  },
                },
                completed_at: null,
                created_at: new Date('2026-03-21T03:54:36Z'),
                updated_at: new Date('2026-03-21T03:58:32Z'),
              },
            ],
            rowCount: 1,
          };
        }
        if (
          sql.includes('UPDATE workflow_work_items')
          && sql.includes("metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state'")
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'review-item-1']);
          return {
            rows: [
              {
                id: 'review-item-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: 'implementation-item',
                request_id: 'req-review-1',
                stage_name: 'review',
                title: 'Review checkpoint',
                goal: 'Review the implementation',
                acceptance_criteria: 'Review and approve the change.',
                column_id: 'planned',
                owner_role: 'reviewer',
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                priority: 'normal',
                notes: 'Open review item awaiting resubmission',
                created_by: 'system',
                metadata: {},
                completed_at: null,
                created_at: new Date('2026-03-21T03:54:36Z'),
                updated_at: new Date('2026-03-21T04:00:00Z'),
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          throw new Error('duplicate review checkpoint should not be inserted');
        }
        if (sql.includes('UPDATE workflow_stages') || sql.includes('UPDATE workflows')) {
          throw new Error(`Unexpected SQL: ${sql}`);
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const activationService = { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) };
    const activationDispatchService = { dispatchActivation: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkItemService(
      { connect: vi.fn().mockResolvedValue(client) } as never,
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
        request_id: 'req-review-2',
        parent_work_item_id: 'implementation-item',
        stage_name: 'review',
        owner_role: 'reviewer',
        title: 'Review checkpoint',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'review-item-1',
        parent_work_item_id: 'implementation-item',
        stage_name: 'review',
        owner_role: 'reviewer',
        next_expected_actor: null,
        next_expected_action: null,
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(activationDispatchService.dispatchActivation).not.toHaveBeenCalled();
  });

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
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'requirements']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
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
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'triage']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
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
    logSafetynetTriggeredMock.mockReset();
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
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'triage']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
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
    expect(logSafetynetTriggeredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'platform.control_plane.idempotent_mutation_replay',
      }),
      'idempotent work item create replay returned stored work item',
      expect.objectContaining({
        workflow_id: 'workflow-1',
        request_id: 'req-1',
      }),
    );
  });

  it('rejects a request_id replay when the existing work item does not match the requested mutation', async () => {
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
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'triage']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
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
      query: vi.fn(async (sql: string, params?: unknown[]) => {
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
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'triage']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
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
      query: vi.fn(async (sql: string, params?: unknown[]) => {
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
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'triage']);
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
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
                next_expected_action: 'assess',
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
    expect((workItem as Record<string, any>).next_expected_action).toBe('assess');
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
              focus_areas: ['Release deliverable must match approved CLI scope.'],
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

  it('falls back to stage gate status when no stage gate row exists yet', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [
          {
            id: 'wi-1',
            workflow_id: 'wf-1',
            parent_work_item_id: null,
            stage_name: 'operator-approval',
            column_id: 'planned',
            owner_role: null,
            next_expected_actor: 'human',
            next_expected_action: 'approve',
            rework_count: 0,
            latest_handoff_completion: 'full',
            unresolved_findings: [],
            focus_areas: [],
            known_risks: [],
            task_count: 1,
            children_count: 0,
            children_completed: 0,
            completed_at: null,
            gate_status: null,
            stage_gate_status: 'not_requested',
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
      next_expected_actor: 'human',
      next_expected_action: 'approve',
      gate_status: 'not_requested',
    });
  });

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
