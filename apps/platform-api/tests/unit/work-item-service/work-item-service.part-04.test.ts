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
});
