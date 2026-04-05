import { beforeEach, describe, expect, it } from 'vitest';

import {
  IDENTITY,
  createWorkflowOperatorBriefRow,
  createWorkflowOperatorBriefServiceTestContext,
} from './support.js';

describe('WorkflowOperatorBriefService linked deliverables', () => {
  let pool: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['pool'];
  let service: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['service'];
  let deliverableService: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['deliverableService'];

  beforeEach(() => {
    ({ pool, service, deliverableService } = createWorkflowOperatorBriefServiceTestContext());
  });

  it('ignores internal workflow task and work item references in linked deliverables', async () => {
    deliverableService.upsertDeliverable.mockResolvedValue({
      descriptor_id: 'descriptor-ignored',
    });
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM tasks')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            is_orchestrator_task: false,
            role: 'Writer',
            state: 'in_progress',
          }],
        };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return { rowCount: 1, rows: [{ id: 'work-item-1' }] };
      }
      if (sql.includes('FROM workflow_operator_briefs') && sql.includes('request_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('COALESCE(MAX(sequence_number), 0) + 1')) {
        return { rowCount: 1, rows: [{ next_sequence: 2 }] };
      }
      if (sql.includes('INSERT INTO workflow_operator_briefs')) {
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-2',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'request-2',
            execution_context_id: 'task-1',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            brief_scope: 'deliverable_context',
            status_kind: 'in_progress',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            sequence_number: 2,
            related_output_descriptor_ids: [],
            created_at: new Date('2026-04-05T16:04:14.752Z'),
            updated_at: new Date('2026-04-05T16:04:14.752Z'),
          })],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordBriefWrite(IDENTITY as never, 'workflow-1', {
      requestId: 'request-2',
      executionContextId: 'task-1',
      workItemId: 'work-item-1',
      taskId: 'task-1',
      payload: {
        shortBrief: {
          headline: 'Critical triage investigation is now assigned',
        },
        detailedBriefJson: {
          headline: 'Critical triage work was seeded',
          summary: 'Created the triage work item and specialist task.',
        },
        linkedDeliverables: [
          {
            descriptorKind: 'deliverable_packet',
            deliveryStage: 'in_progress',
            title: 'Triage analysis task',
            state: 'draft',
            primaryTarget: {
              target_kind: 'inline_summary',
              label: 'Triage analysis task',
              path: 'workflow task db496104-a403-48f7-86b7-3518f2626b85',
            },
          },
          {
            descriptorKind: 'deliverable_packet',
            deliveryStage: 'in_progress',
            title: 'Triage work item',
            state: 'draft',
            primaryTarget: {
              target_kind: 'inline_summary',
              label: 'Triage work item',
              path: 'workflow work item 8f1678cb-8df1-4007-8bbd-ed1275e03a0f',
            },
          },
        ],
      },
    } as never);

    expect(deliverableService.upsertDeliverable).not.toHaveBeenCalled();
    expect(result.record.related_output_descriptor_ids).toEqual([]);
  });
});
