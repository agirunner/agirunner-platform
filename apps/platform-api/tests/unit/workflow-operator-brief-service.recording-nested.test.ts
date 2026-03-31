import { beforeEach, describe, expect, it } from 'vitest';

import { IDENTITY, createWorkflowOperatorBriefRow, createWorkflowOperatorBriefServiceTestContext } from './workflow-operator-brief-service.test-support.js';

describe('WorkflowOperatorBriefService recording: nested payloads', () => {
  let pool: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['pool'];
  let service: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['service'];
  let deliverableService: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['deliverableService'];

  beforeEach(() => {
    ({ pool, service, deliverableService } = createWorkflowOperatorBriefServiceTestContext());
  });

  it('records nested brief payloads, validates execution identity, and materializes linked deliverables', async () => {
    deliverableService.upsertDeliverable.mockResolvedValue({
      descriptor_id: 'descriptor-2',
    });
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM tasks')) {
        expect(params).toEqual([
          'tenant-1',
          'workflow-1',
          'task-1',
          [
            'claimed',
            'in_progress',
            'output_pending_assessment',
            'awaiting_approval',
            'completed',
            'failed',
            'cancelled',
            'escalated',
          ],
        ]);
        return {
          rowCount: 1,
          rows: [{
            id: 'task-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            is_orchestrator_task: false,
            role: 'Verifier',
            state: 'in_progress',
          }],
        };
      }
      if (sql.includes('FROM workflow_operator_briefs') && sql.includes('request_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_work_items')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
        return { rowCount: 1, rows: [{ id: 'work-item-1' }] };
      }
      if (sql.includes('COALESCE(MAX(sequence_number), 0) + 1')) {
        return { rowCount: 1, rows: [{ next_sequence: 3 }] };
      }
      if (sql.includes('UPDATE workflow_operator_briefs')) {
        expect(params?.[0]).toBe(JSON.stringify(['descriptor-2']));
        expect(params?.[1]).toBe(JSON.stringify(['artifact-1']));
        expect(params?.[2]).toBe('tenant-1');
        expect(params?.[3]).toBe('workflow-1');
        expect(params?.[4]).toBe('brief-1');
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'request-1',
            execution_context_id: 'task-1',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            status_kind: 'in_progress',
            short_brief: {
              headline: 'Release package is ready for approval.',
              status_label: 'Needs Action',
              delta_label: 'approval requested',
              next_action_label: 'Approve release',
            },
            detailed_brief_json: {
              headline: 'Release package is ready for approval.',
              status_kind: 'in_progress',
              summary: 'Verification completed and release is ready for operator approval.',
              sections: {
                deliverables: ['Release notes approved.'],
                validation: ['redacted://workflow-brief-secret'],
                links: [
                  {
                    label: 'Preview package',
                    url: 'https://example.invalid/release',
                  },
                ],
              },
            },
            linked_target_ids: ['target-work-item-2'],
            sequence_number: 3,
            related_artifact_ids: ['artifact-1'],
            related_output_descriptor_ids: ['descriptor-2'],
            related_intervention_ids: ['intervention-1'],
            created_at: new Date('2026-03-27T17:00:00.000Z'),
            updated_at: new Date('2026-03-27T17:00:00.000Z'),
          })],
        };
      }
      if (sql.includes('INSERT INTO workflow_operator_briefs')) {
        expect(JSON.parse(String(params?.[10]))).toEqual({
          headline: 'Release package is ready for approval.',
          status_label: 'Needs Action',
          delta_label: 'approval requested',
          next_action_label: 'Approve release',
        });
        expect(JSON.parse(String(params?.[11]))).toEqual({
          headline: 'Release package is ready for approval.',
          status_kind: 'in_progress',
          summary: 'Verification completed and release is ready for operator approval.',
          sections: {
            deliverables: ['Release notes approved.'],
            validation: ['redacted://workflow-brief-secret'],
            links: [
              {
                label: 'Preview package',
                url: 'https://example.invalid/release',
              },
            ],
          },
        });
        expect(params?.[13]).toBe(JSON.stringify(['target-work-item-2']));
        expect(params?.[14]).toBe(JSON.stringify(['artifact-1']));
        expect(params?.[15]).toBe(JSON.stringify([]));
        expect(params?.[16]).toBe(JSON.stringify(['intervention-1']));
        expect(params?.[18]).toBeNull();
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'request-1',
            execution_context_id: 'task-1',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            status_kind: 'in_progress',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            linked_target_ids: JSON.parse(String(params?.[13])),
            sequence_number: 3,
            related_artifact_ids: ['artifact-1'],
            related_output_descriptor_ids: [],
            related_intervention_ids: ['intervention-1'],
            created_at: new Date('2026-03-27T17:00:00.000Z'),
            updated_at: new Date('2026-03-27T17:00:00.000Z'),
          })],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordBriefWrite(IDENTITY as never, 'workflow-1', {
      requestId: 'request-1',
      executionContextId: 'task-1',
      workItemId: 'work-item-1',
      taskId: 'task-1',
      briefKind: 'milestone',
      briefScope: 'workflow_timeline',
      sourceKind: 'specialist',
      sourceRoleName: 'Verifier',
      statusKind: 'in_progress',
      payload: {
        shortBrief: {
          headline: 'Release package is ready for approval.',
          status_label: 'Needs Action',
          delta_label: 'approval requested',
          next_action_label: 'Approve release',
        },
        detailedBriefJson: {
          headline: 'Release package is ready for approval.',
          status_kind: 'in_progress',
          summary: 'Verification completed and release is ready for operator approval.',
          sections: {
            deliverables: ['Release notes approved.'],
            validation: ['Bearer super-secret-token'],
            links: [
              {
                label: 'Preview package',
                url: 'https://example.invalid/release',
              },
            ],
          },
        },
        linkedDeliverables: [
          {
            descriptorKind: 'artifact',
            deliveryStage: 'final',
            title: 'Release bundle',
            state: 'final',
            summaryBrief: 'Ready to download.',
            primaryTarget: {
              target_kind: 'artifact',
              label: 'Download bundle',
              url: 'https://example.invalid/bundle.zip',
            },
          },
        ],
        linkedTargetIds: ['target-work-item-2'],
      },
      relatedArtifactIds: ['artifact-1'],
      relatedInterventionIds: ['intervention-1'],
    });

    expect(deliverableService.upsertDeliverable).toHaveBeenCalledWith(
      IDENTITY,
      'workflow-1',
      expect.objectContaining({
        sourceBriefId: 'brief-1',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        record_id: 'brief-1',
        sequence_number: 3,
        deduped: false,
        record: expect.objectContaining({
          id: 'brief-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          sequence_number: 3,
          short_brief: expect.objectContaining({
            headline: 'Release package is ready for approval.',
          }),
          detailed_brief_json: expect.objectContaining({
            sections: expect.objectContaining({
              validation: ['redacted://workflow-brief-secret'],
            }),
          }),
          related_output_descriptor_ids: ['descriptor-2'],
          linked_target_ids: ['target-work-item-2'],
        }),
      }),
    );
  });
});
