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
});
