import { beforeEach, describe, expect, it } from 'vitest';

import { IDENTITY, createWorkflowOperatorBriefRow, createWorkflowOperatorBriefServiceTestContext } from './support.js';

describe('WorkflowOperatorBriefService deliverables', () => {
  let pool: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['pool'];
  let service: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['service'];
  let deliverableService: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['deliverableService'];

  beforeEach(() => {
    ({ pool, service, deliverableService } = createWorkflowOperatorBriefServiceTestContext());
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

  it('rebuilds a finalized deliverable packet when a replayed brief points at a stale descriptor id', async () => {
    deliverableService.upsertDeliverable.mockResolvedValue({
      descriptor_id: 'descriptor-11',
    });
    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM tasks')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-11',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-11',
            is_orchestrator_task: false,
            role: 'Writer',
            state: 'completed',
          }],
        };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return { rowCount: 1, rows: [{ id: 'work-item-11' }] };
      }
      if (sql.includes('FROM workflow_operator_briefs') && sql.includes('request_id = $3')) {
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-11',
            work_item_id: 'work-item-11',
            task_id: 'task-11',
            request_id: 'request-11',
            execution_context_id: 'task-11',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            brief_scope: 'deliverable_context',
            status_kind: 'completed',
            short_brief: { headline: 'Replayable final packet.' },
            detailed_brief_json: {
              headline: 'Replayable final packet.',
              status_kind: 'completed',
              summary: 'The brief still points at a stale descriptor id.',
            },
            linked_target_ids: [],
            sequence_number: 11,
            related_artifact_ids: ['artifact-11'],
            related_output_descriptor_ids: ['descriptor-stale'],
            created_at: new Date('2026-03-28T11:00:00.000Z'),
            updated_at: new Date('2026-03-28T11:00:00.000Z'),
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
            id: 'artifact-11',
            task_id: 'task-11',
            logical_path: 'artifact:workflow/output/rebuilt-final-packet.md',
            content_type: 'text/markdown',
          }],
        };
      }
      if (sql.includes('UPDATE workflow_operator_briefs')) {
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-11',
            work_item_id: 'work-item-11',
            task_id: 'task-11',
            request_id: 'request-11',
            execution_context_id: 'task-11',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            brief_scope: 'deliverable_context',
            status_kind: 'completed',
            short_brief: { headline: 'Replayable final packet.' },
            detailed_brief_json: {
              headline: 'Replayable final packet.',
              status_kind: 'completed',
              summary: 'The brief still points at a stale descriptor id.',
            },
            linked_target_ids: [],
            sequence_number: 11,
            related_artifact_ids: ['artifact-11'],
            related_output_descriptor_ids: ['descriptor-11'],
            created_at: new Date('2026-03-28T11:00:00.000Z'),
            updated_at: new Date('2026-03-28T11:00:00.000Z'),
          })],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordBriefWrite(IDENTITY as never, 'workflow-1', {
      requestId: 'request-11',
      executionContextId: 'task-11',
      workItemId: 'work-item-11',
      taskId: 'task-11',
      relatedArtifactIds: ['artifact-11'],
      payload: {
        shortBrief: {
          headline: 'Replayable final packet.',
        },
        detailedBriefJson: {
          headline: 'Replayable final packet.',
          status_kind: 'completed',
          summary: 'The brief still points at a stale descriptor id.',
        },
      },
    } as never);

    expect(result.deduped).toBe(true);
    expect(deliverableService.upsertDeliverable).toHaveBeenCalledWith(
      IDENTITY,
      'workflow-1',
      expect.objectContaining({
        sourceBriefId: 'brief-11',
        descriptorKind: 'brief_packet',
        workItemId: 'work-item-11',
        primaryTarget: expect.objectContaining({
          artifact_id: 'artifact-11',
          url: '/api/v1/tasks/task-11/artifacts/artifact-11/preview',
        }),
      }),
    );
    expect(result.record.related_output_descriptor_ids).toEqual(['descriptor-11']);
  });

  it('does not materialize a work-item deliverable packet from an orchestrator brief that only links to a work item target', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM tasks')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_activations')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'activation-11',
            workflow_id: 'workflow-1',
            activation_id: 'activation-11',
            state: 'running',
            consumed_at: null,
          }],
        };
      }
      if (sql.includes('FROM workflow_operator_briefs') && sql.includes('request_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('COALESCE(MAX(sequence_number), 0) + 1')) {
        return { rowCount: 1, rows: [{ next_sequence: 12 }] };
      }
      if (sql.includes('INSERT INTO workflow_operator_briefs')) {
        expect(params?.[3]).toBeNull();
        expect(params?.[13]).toBe(JSON.stringify(['work-item-11', 'task-11']));
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-12',
            work_item_id: null,
            task_id: null,
            request_id: params?.[5] as string,
            execution_context_id: 'activation-11',
            source_kind: 'orchestrator',
            source_role_name: 'Orchestrator',
            brief_scope: 'deliverable_context',
            status_kind: 'completed',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            linked_target_ids: ['work-item-11', 'task-11'],
            sequence_number: 12,
            created_at: new Date('2026-03-28T12:00:00.000Z'),
            updated_at: new Date('2026-03-28T12:00:00.000Z'),
          })],
        };
      }
      if (sql.includes('FROM workflow_work_items') && sql.includes('id::text = ANY($3::text[])')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', ['work-item-11', 'task-11']]);
        return {
          rowCount: 1,
          rows: [{ id: 'work-item-11' }],
        };
      }
      if (sql.includes('FROM workflow_output_descriptors') && sql.includes('source_brief_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('UPDATE workflow_operator_briefs')) {
        expect(params?.[0]).toBe(JSON.stringify([]));
        expect(params?.[2]).toBe('tenant-1');
        expect(params?.[3]).toBe('workflow-1');
        expect(params?.[4]).toBe('brief-12');
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-12',
            work_item_id: null,
            task_id: null,
            request_id: 'request-12',
            execution_context_id: 'activation-11',
            source_kind: 'orchestrator',
            source_role_name: 'Orchestrator',
            brief_scope: 'deliverable_context',
            status_kind: 'completed',
            short_brief: {
              headline: 'workflow-intake-11 completion packet',
            },
            detailed_brief_json: {
              headline: 'workflow-intake-11 completion packet',
              status_kind: 'completed',
              summary: 'The orchestrator observed closure after the specialist completed the packet.',
            },
            linked_target_ids: ['work-item-11', 'task-11'],
            sequence_number: 12,
            created_at: new Date('2026-03-28T12:00:00.000Z'),
            updated_at: new Date('2026-03-28T12:00:00.000Z'),
          })],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordBriefWrite(IDENTITY as never, 'workflow-1', {
      requestId: 'request-12',
      executionContextId: 'activation-11',
      sourceKind: 'orchestrator',
      payload: {
        shortBrief: {
          headline: 'workflow-intake-11 completion packet',
        },
        detailedBriefJson: {
          headline: 'workflow-intake-11 completion packet',
          status_kind: 'completed',
          summary: 'The orchestrator observed closure after the specialist completed the packet.',
        },
        linkedTargetIds: ['work-item-11', 'task-11'],
      },
    } as never);

    expect(result.record.work_item_id).toBeNull();
    expect(result.record.related_output_descriptor_ids).toEqual([]);
    expect(deliverableService.upsertDeliverable).not.toHaveBeenCalled();
  });

  it('does not materialize explicit linked deliverables that only reference internal task or work-item targets', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM tasks')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_activations')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'activation-13',
            workflow_id: 'workflow-1',
            activation_id: 'activation-13',
            state: 'running',
            consumed_at: null,
          }],
        };
      }
      if (sql.includes('FROM workflow_operator_briefs') && sql.includes('request_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('COALESCE(MAX(sequence_number), 0) + 1')) {
        return { rowCount: 1, rows: [{ next_sequence: 13 }] };
      }
      if (sql.includes('INSERT INTO workflow_operator_briefs')) {
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-13',
            work_item_id: null,
            task_id: null,
            request_id: params?.[5] as string,
            execution_context_id: 'activation-13',
            source_kind: 'orchestrator',
            source_role_name: 'Orchestrator',
            brief_scope: 'deliverable_context',
            status_kind: 'in_progress',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            linked_target_ids: [],
            sequence_number: 13,
            created_at: new Date('2026-03-28T13:00:00.000Z'),
            updated_at: new Date('2026-03-28T13:00:00.000Z'),
          })],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordBriefWrite(IDENTITY as never, 'workflow-1', {
      requestId: 'request-13',
      executionContextId: 'activation-13',
      sourceKind: 'orchestrator',
      payload: {
        shortBrief: {
          headline: 'Seeded the first work item and starter task.',
        },
        detailedBriefJson: {
          headline: 'Seeded the first work item and starter task.',
          status_kind: 'in_progress',
        },
        linkedDeliverables: [
          {
            descriptorKind: 'deliverable_packet',
            deliveryStage: 'in_progress',
            title: 'Research Analyst starter task',
            state: 'draft',
            previewCapabilities: {
              can_inline_preview: true,
              can_download: false,
              can_open_external: false,
              can_copy_path: true,
              preview_kind: 'structured_summary',
            },
            primaryTarget: {
              target_kind: 'inline_summary',
              label: 'Research Analyst starter task',
              path: 'task:00000000-0000-0000-0000-000000000301',
            },
            secondaryTargets: [],
            contentPreview: {
              summary: 'Task placeholder only.',
            },
          },
          {
            descriptorKind: 'deliverable_packet',
            deliveryStage: 'in_progress',
            title: 'Question-framing work item',
            state: 'draft',
            previewCapabilities: {
              can_inline_preview: true,
              can_download: false,
              can_open_external: false,
              can_copy_path: true,
              preview_kind: 'structured_summary',
            },
            primaryTarget: {
              target_kind: 'inline_summary',
              label: 'Question-framing work item',
              path: 'work_item:00000000-0000-0000-0000-000000000201',
            },
            secondaryTargets: [],
            contentPreview: {
              summary: 'Work item placeholder only.',
            },
          },
        ],
      },
    } as never);

    expect(result.record.work_item_id).toBeNull();
    expect(result.record.related_output_descriptor_ids).toEqual([]);
    expect(deliverableService.upsertDeliverable).not.toHaveBeenCalled();
  });
});
