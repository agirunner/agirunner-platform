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

  it('does not reuse a different open planned child work item in the same stage and role', async () => {
    let insertCount = 0;
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
                  roles: ['architect', 'builder'],
                  lifecycle: 'planned',
                  board: {
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [
                    { name: 'solution-design', goal: 'Design it' },
                    { name: 'implementation', goal: 'Build it' },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT gate_status') && sql.includes('FROM workflow_stages')) {
          return { rows: [{ gate_status: 'not_requested' }], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'design-item']);
          return {
            rows: [
              {
                id: 'design-item',
                title: 'Design breakdown',
                stage_name: 'solution-design',
                column_id: 'done',
                completed_at: new Date('2026-03-26T09:59:40Z'),
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: 'full',
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.startsWith('SELECT COUNT(*)::int AS count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'design-item']);
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
            'design-item',
            'implementation',
            'builder',
          ]);
          return {
            rows: [
              {
                id: 'impl-item-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: 'design-item',
                request_id: 'req-impl-1',
                stage_name: 'implementation',
                title: 'Implement chunk greeting-copy',
                goal: 'Write greeting-copy output',
                acceptance_criteria: 'Create deliverables/greeting-copy.txt',
                column_id: 'planned',
                owner_role: 'builder',
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                priority: 'normal',
                notes: 'chunk greeting-copy',
                created_by: 'orchestrator',
                metadata: { chunk_id: 'greeting-copy' },
                branch_id: null,
                completed_at: null,
                created_at: new Date('2026-03-26T10:00:00Z'),
                updated_at: new Date('2026-03-26T10:00:00Z'),
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          insertCount += 1;
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'design-item',
            'req-impl-2',
            'implementation',
            'Implement chunk greeting-format',
            'Write greeting-format output',
            'Create deliverables/greeting-format.txt',
            'planned',
            'builder',
            null,
            null,
            0,
            'normal',
            'chunk greeting-format',
            'manual',
            { chunk_id: 'greeting-format' },
            null,
          ]);
          return {
            rows: [
              {
                id: 'impl-item-2',
                workflow_id: 'workflow-1',
                parent_work_item_id: 'design-item',
                request_id: 'req-impl-2',
                stage_name: 'implementation',
                title: 'Implement chunk greeting-format',
                goal: 'Write greeting-format output',
                acceptance_criteria: 'Create deliverables/greeting-format.txt',
                column_id: 'planned',
                owner_role: 'builder',
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                priority: 'normal',
                notes: 'chunk greeting-format',
                created_by: 'manual',
                metadata: { chunk_id: 'greeting-format' },
                branch_id: null,
                completed_at: null,
                created_at: new Date('2026-03-26T10:01:00Z'),
                updated_at: new Date('2026-03-26T10:01:00Z'),
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('UPDATE workflow_stages') || sql.includes('UPDATE workflows')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT wi.id') && sql.includes('FROM workflow_work_items wi')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT ws.id') && sql.includes('FROM workflow_stages ws')) {
          return {
            rows: [
              {
                id: 'stage-1',
                lifecycle: 'planned',
                name: 'solution-design',
                position: 0,
                goal: 'Design it',
                guidance: null,
                status: 'completed',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: new Date('2026-03-26T09:55:00Z'),
                completed_at: new Date('2026-03-26T09:59:40Z'),
                open_work_item_count: 0,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-26T09:56:00Z'),
                last_completed_work_item_at: new Date('2026-03-26T09:59:40Z'),
              },
              {
                id: 'stage-2',
                lifecycle: 'planned',
                name: 'implementation',
                position: 1,
                goal: 'Build it',
                guidance: null,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: new Date('2026-03-26T10:00:00Z'),
                completed_at: null,
                open_work_item_count: 2,
                total_work_item_count: 2,
                first_work_item_at: new Date('2026-03-26T10:00:00Z'),
                last_completed_work_item_at: null,
              },
            ],
            rowCount: 2,
          };
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
        request_id: 'req-impl-2',
        parent_work_item_id: 'design-item',
        stage_name: 'implementation',
        owner_role: 'builder',
        title: 'Implement chunk greeting-format',
        goal: 'Write greeting-format output',
        acceptance_criteria: 'Create deliverables/greeting-format.txt',
        notes: 'chunk greeting-format',
        metadata: { chunk_id: 'greeting-format' },
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'impl-item-2',
        title: 'Implement chunk greeting-format',
      }),
    );
    expect(insertCount).toBe(1);
    expect(eventService.emit).toHaveBeenCalledTimes(1);
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledTimes(1);
    expect(activationDispatchService.dispatchActivation).toHaveBeenCalledTimes(1);
  });
});
