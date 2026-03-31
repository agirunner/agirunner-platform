import { beforeEach, describe, expect, it } from 'vitest';

import { IDENTITY, createWorkflowOperatorBriefRow, createWorkflowOperatorBriefServiceTestContext } from './support.js';

describe('WorkflowOperatorBriefService deliverable packets', () => {
  let pool: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['pool'];
  let service: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['service'];
  let deliverableService: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['deliverableService'];

  beforeEach(() => {
    ({ pool, service, deliverableService } = createWorkflowOperatorBriefServiceTestContext());
  });

  it('materializes a canonical deliverable packet for finalized deliverable-context briefs without explicit linked descriptors', async () => {
    deliverableService.upsertDeliverable.mockResolvedValue({
      descriptor_id: 'descriptor-9',
    });
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM tasks')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-9',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-9',
            is_orchestrator_task: false,
            role: 'Writer',
            state: 'completed',
          }],
        };
      }
      if (sql.includes('FROM workflow_operator_briefs') && sql.includes('request_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return { rowCount: 1, rows: [{ id: 'work-item-9' }] };
      }
      if (sql.includes('COALESCE(MAX(sequence_number), 0) + 1')) {
        return { rowCount: 1, rows: [{ next_sequence: 9 }] };
      }
      if (sql.includes('INSERT INTO workflow_operator_briefs')) {
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-9',
            work_item_id: 'work-item-9',
            task_id: 'task-9',
            request_id: params?.[5] as string,
            execution_context_id: 'task-9',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            brief_scope: 'deliverable_context',
            status_kind: 'completed',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            linked_target_ids: [],
            sequence_number: 9,
            related_artifact_ids: ['artifact-9'],
            created_at: new Date('2026-03-28T09:00:00.000Z'),
            updated_at: new Date('2026-03-28T09:00:00.000Z'),
          })],
        };
      }
      if (sql.includes('FROM workflow_output_descriptors') && sql.includes('source_brief_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_artifacts')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', ['artifact-9']]);
        return {
          rowCount: 1,
          rows: [{
            id: 'artifact-9',
            task_id: 'task-9',
            logical_path: 'artifact:workflow/output/final-packet.md',
            content_type: 'text/markdown',
          }],
        };
      }
      if (sql.includes('UPDATE workflow_operator_briefs')) {
        expect(params?.[0]).toBe(JSON.stringify(['descriptor-9']));
        expect(params?.[1]).toBe(JSON.stringify(['artifact-9']));
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-9',
            work_item_id: 'work-item-9',
            task_id: 'task-9',
            request_id: 'request-9',
            execution_context_id: 'task-9',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            brief_scope: 'deliverable_context',
            status_kind: 'completed',
            short_brief: { headline: 'Final packet is complete.' },
            detailed_brief_json: {
              headline: 'Final packet is complete.',
              status_kind: 'completed',
              summary: 'Published the final packet for the work item.',
            },
            linked_target_ids: [],
            sequence_number: 9,
            related_artifact_ids: ['artifact-9'],
            related_output_descriptor_ids: ['descriptor-9'],
            created_at: new Date('2026-03-28T09:00:00.000Z'),
            updated_at: new Date('2026-03-28T09:00:00.000Z'),
          })],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordBriefWrite(IDENTITY as never, 'workflow-1', {
      requestId: 'request-9',
      executionContextId: 'task-9',
      workItemId: 'work-item-9',
      taskId: 'task-9',
      relatedArtifactIds: ['artifact-9'],
      payload: {
        shortBrief: {
          headline: 'Final packet is complete.',
        },
        detailedBriefJson: {
          headline: 'Final packet is complete.',
          status_kind: 'completed',
          summary: 'Published the final packet for the work item.',
        },
      },
    } as never);

    expect(deliverableService.upsertDeliverable).toHaveBeenCalledWith(
      IDENTITY,
      'workflow-1',
      expect.objectContaining({
        workItemId: 'work-item-9',
        descriptorKind: 'brief_packet',
        deliveryStage: 'final',
        state: 'final',
        sourceBriefId: 'brief-9',
        primaryTarget: expect.objectContaining({
          target_kind: 'artifact',
          artifact_id: 'artifact-9',
          url: '/api/v1/tasks/task-9/artifacts/artifact-9/preview',
          path: 'artifact:workflow/output/final-packet.md',
        }),
      }),
    );
    expect(result.record.related_output_descriptor_ids).toEqual(['descriptor-9']);
  });

  it('backfills a missing deliverable descriptor when a finalized deliverable-context brief is replayed by request id', async () => {
    deliverableService.upsertDeliverable.mockResolvedValue({
      descriptor_id: 'descriptor-10',
    });
    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM tasks')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-10',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-10',
            is_orchestrator_task: false,
            role: 'Writer',
            state: 'completed',
          }],
        };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return { rowCount: 1, rows: [{ id: 'work-item-10' }] };
      }
      if (sql.includes('FROM workflow_operator_briefs') && sql.includes('request_id = $3')) {
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-10',
            work_item_id: 'work-item-10',
            task_id: 'task-10',
            request_id: 'request-10',
            execution_context_id: 'task-10',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            brief_scope: 'deliverable_context',
            status_kind: 'completed',
            short_brief: { headline: 'Replayable final packet.' },
            detailed_brief_json: {
              headline: 'Replayable final packet.',
              status_kind: 'completed',
              summary: 'The brief was written before descriptor promotion existed.',
            },
            linked_target_ids: [],
            sequence_number: 10,
            related_artifact_ids: ['artifact-10'],
            related_output_descriptor_ids: [],
            created_at: new Date('2026-03-28T10:00:00.000Z'),
            updated_at: new Date('2026-03-28T10:00:00.000Z'),
          })],
        };
      }
      if (sql.includes('FROM workflow_output_descriptors') && sql.includes('source_brief_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_artifacts')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'artifact-10',
            task_id: 'task-10',
            logical_path: 'artifact:workflow/output/replayable-final-packet.md',
            content_type: 'text/markdown',
          }],
        };
      }
      if (sql.includes('UPDATE workflow_operator_briefs')) {
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-10',
            work_item_id: 'work-item-10',
            task_id: 'task-10',
            request_id: 'request-10',
            execution_context_id: 'task-10',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            brief_scope: 'deliverable_context',
            status_kind: 'completed',
            short_brief: { headline: 'Replayable final packet.' },
            detailed_brief_json: {
              headline: 'Replayable final packet.',
              status_kind: 'completed',
              summary: 'The brief was written before descriptor promotion existed.',
            },
            linked_target_ids: [],
            sequence_number: 10,
            related_artifact_ids: ['artifact-10'],
            related_output_descriptor_ids: ['descriptor-10'],
            created_at: new Date('2026-03-28T10:00:00.000Z'),
            updated_at: new Date('2026-03-28T10:00:00.000Z'),
          })],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordBriefWrite(IDENTITY as never, 'workflow-1', {
      requestId: 'request-10',
      executionContextId: 'task-10',
      workItemId: 'work-item-10',
      taskId: 'task-10',
      relatedArtifactIds: ['artifact-10'],
      payload: {
        shortBrief: {
          headline: 'Replayable final packet.',
        },
        detailedBriefJson: {
          headline: 'Replayable final packet.',
          status_kind: 'completed',
          summary: 'The brief was written before descriptor promotion existed.',
        },
      },
    } as never);

    expect(result.deduped).toBe(true);
    expect(deliverableService.upsertDeliverable).toHaveBeenCalledWith(
      IDENTITY,
      'workflow-1',
      expect.objectContaining({
        sourceBriefId: 'brief-10',
        descriptorKind: 'brief_packet',
        primaryTarget: expect.objectContaining({
          artifact_id: 'artifact-10',
          url: '/api/v1/tasks/task-10/artifacts/artifact-10/preview',
        }),
      }),
    );
    expect(result.record.related_output_descriptor_ids).toEqual(['descriptor-10']);
  });
});
