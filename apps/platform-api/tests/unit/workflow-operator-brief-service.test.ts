import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkflowOperatorBriefService } from '../../src/services/workflow-operator-brief-service.js';

const IDENTITY = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'user',
  ownerId: 'user-1',
  keyPrefix: 'admin',
} as const;

function createPool() {
  return {
    query: vi.fn(),
  };
}

describe('WorkflowOperatorBriefService', () => {
  let pool: ReturnType<typeof createPool>;
  let service: WorkflowOperatorBriefService;
  let deliverableService: { upsertDeliverable: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    pool = createPool();
    deliverableService = {
      upsertDeliverable: vi.fn(),
    };
    service = new WorkflowOperatorBriefService(pool as never, deliverableService as never);
  });

  it('lists workflow operator briefs newest first with optional work-item filtering', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_operator_briefs')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1', null, 2]);
        return {
          rowCount: 2,
          rows: [
            {
              id: 'brief-2',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              task_id: null,
              request_id: 'request-2',
              execution_context_id: 'execution-2',
              brief_kind: 'milestone',
              brief_scope: 'workflow_timeline',
              source_kind: 'orchestrator',
              source_role_name: 'Orchestrator',
              status_kind: 'in_progress',
              short_brief: { headline: 'Newer brief' },
              detailed_brief_json: { headline: 'Newer brief', status_kind: 'in_progress' },
              linked_target_ids: ['work-item-1'],
              sequence_number: 5,
              related_artifact_ids: [],
              related_output_descriptor_ids: [],
              related_intervention_ids: [],
              canonical_workflow_brief_id: null,
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: new Date('2026-03-27T18:00:00.000Z'),
              updated_at: new Date('2026-03-27T18:00:00.000Z'),
            },
            {
              id: 'brief-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              task_id: null,
              request_id: 'request-1',
              execution_context_id: 'execution-1',
              brief_kind: 'milestone',
              brief_scope: 'workflow_timeline',
              source_kind: 'specialist',
              source_role_name: 'Verifier',
              status_kind: 'handoff',
              short_brief: { headline: 'Older brief' },
              detailed_brief_json: { headline: 'Older brief', status_kind: 'handoff' },
              linked_target_ids: [],
              sequence_number: 4,
              related_artifact_ids: [],
              related_output_descriptor_ids: [],
              related_intervention_ids: [],
              canonical_workflow_brief_id: null,
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: new Date('2026-03-27T17:00:00.000Z'),
              updated_at: new Date('2026-03-27T17:00:00.000Z'),
            },
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.listBriefs('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      limit: 2,
    });

    expect(result.map((entry) => entry.id)).toEqual(['brief-2', 'brief-1']);
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
          rows: [{
            id: 'brief-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'request-1',
            execution_context_id: 'task-1',
            brief_kind: 'milestone',
            brief_scope: 'workflow_timeline',
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
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-27T17:00:00.000Z'),
            updated_at: new Date('2026-03-27T17:00:00.000Z'),
          }],
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
        return {
          rowCount: 1,
          rows: [{
            id: 'brief-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'request-1',
            execution_context_id: 'task-1',
            brief_kind: 'milestone',
            brief_scope: 'workflow_timeline',
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
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-27T17:00:00.000Z'),
            updated_at: new Date('2026-03-27T17:00:00.000Z'),
          }],
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

  it('dedupes repeated brief writes by request id', async () => {
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
            state: 'claimed',
          }],
        };
      }
      if (sql.includes('FROM workflow_work_items')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
        return { rowCount: 1, rows: [{ id: 'work-item-1' }] };
      }
      if (sql.includes('FROM workflow_operator_briefs') && sql.includes('request_id = $3')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'brief-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'request-1',
            execution_context_id: 'task-1',
            brief_kind: 'milestone',
            brief_scope: 'workflow_timeline',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            status_kind: 'in_progress',
            short_brief: { headline: 'Existing brief' },
            detailed_brief_json: { headline: 'Existing brief', status_kind: 'in_progress' },
            linked_target_ids: [],
            sequence_number: 3,
            related_artifact_ids: [],
            related_output_descriptor_ids: [],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-27T17:00:00.000Z'),
            updated_at: new Date('2026-03-27T17:00:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordBriefWrite(IDENTITY as never, 'workflow-1', {
      requestId: 'request-1',
      executionContextId: 'task-1',
      briefKind: 'milestone',
      briefScope: 'workflow_timeline',
      sourceKind: 'specialist',
      statusKind: 'in_progress',
      payload: {
        shortBrief: { headline: 'Existing brief' },
        detailedBriefJson: { headline: 'Existing brief', status_kind: 'in_progress' },
      },
    });

    expect(deliverableService.upsertDeliverable).not.toHaveBeenCalled();
    expect(result.deduped).toBe(true);
    expect(result.record_id).toBe('brief-1');
  });

  it('derives persisted status_kind from the detailed brief when the top-level field is omitted', async () => {
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
            role: 'Verifier',
            state: 'completed',
          }],
        };
      }
      if (sql.includes('FROM workflow_operator_briefs') && sql.includes('request_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return { rowCount: 1, rows: [{ id: 'work-item-1' }] };
      }
      if (sql.includes('COALESCE(MAX(sequence_number), 0) + 1')) {
        return { rowCount: 1, rows: [{ next_sequence: 6 }] };
      }
      if (sql.includes('INSERT INTO workflow_operator_briefs')) {
        expect(params?.[12]).toBe('handoff');
        return {
          rowCount: 1,
          rows: [{
            id: 'brief-6',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'request-6',
            execution_context_id: 'task-1',
            brief_kind: 'milestone',
            brief_scope: 'work_item_handoff',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            status_kind: 'handoff',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            linked_target_ids: [],
            sequence_number: 6,
            related_artifact_ids: [],
            related_output_descriptor_ids: [],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T01:00:00.000Z'),
            updated_at: new Date('2026-03-28T01:00:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordBriefWrite(IDENTITY as never, 'workflow-1', {
      requestId: 'request-6',
      executionContextId: 'task-1',
      workItemId: 'work-item-1',
      taskId: 'task-1',
      briefKind: 'milestone',
      briefScope: 'work_item_handoff',
      sourceKind: 'specialist',
      payload: {
        shortBrief: {
          headline: 'Verifier handed the packet back for review.',
        },
        detailedBriefJson: {
          headline: 'Verifier handed the packet back for review.',
          status_kind: 'handoff',
          summary: 'The packet is ready for the next reviewer.',
        },
      },
    } as never);

    expect(result.record.status_kind).toBe('handoff');
  });

  it('derives request, source, brief kind, and brief scope defaults when omitted', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM tasks')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-2',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-2',
            is_orchestrator_task: false,
            role: 'Verifier',
            state: 'completed',
          }],
        };
      }
      if (sql.includes('FROM workflow_operator_briefs') && sql.includes('request_id = $3')) {
        expect(params?.[2]).toEqual(expect.any(String));
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return { rowCount: 1, rows: [{ id: 'work-item-2' }] };
      }
      if (sql.includes('COALESCE(MAX(sequence_number), 0) + 1')) {
        return { rowCount: 1, rows: [{ next_sequence: 7 }] };
      }
      if (sql.includes('INSERT INTO workflow_operator_briefs')) {
        expect(params?.[5]).toEqual(expect.any(String));
        expect(params?.[7]).toBe('milestone');
        expect(params?.[8]).toBe('work_item_handoff');
        expect(params?.[9]).toBe('specialist');
        expect(params?.[12]).toBe('handoff');
        return {
          rowCount: 1,
          rows: [{
            id: 'brief-7',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-2',
            task_id: 'task-2',
            request_id: params?.[5],
            execution_context_id: 'task-2',
            brief_kind: 'milestone',
            brief_scope: 'work_item_handoff',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            status_kind: 'handoff',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            linked_target_ids: [],
            sequence_number: 7,
            related_artifact_ids: [],
            related_output_descriptor_ids: [],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T02:00:00.000Z'),
            updated_at: new Date('2026-03-28T02:00:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordBriefWrite(IDENTITY as never, 'workflow-1', {
      executionContextId: 'task-2',
      workItemId: 'work-item-2',
      taskId: 'task-2',
      payload: {
        shortBrief: {
          headline: 'Verifier finished the handoff packet.',
        },
        detailedBriefJson: {
          headline: 'Verifier finished the handoff packet.',
          status_kind: 'handoff',
        },
      },
    } as never);

    expect(result.record.request_id).toEqual(expect.any(String));
    expect(result.record.brief_kind).toBe('milestone');
    expect(result.record.brief_scope).toBe('work_item_handoff');
    expect(result.record.source_kind).toBe('specialist');
    expect(result.record.status_kind).toBe('handoff');
  });
});
