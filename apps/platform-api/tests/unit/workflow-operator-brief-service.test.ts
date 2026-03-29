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
        expect(params).toEqual([
          'tenant-1',
          'workflow-1',
          'work-item-1',
          'work-item-1',
          null,
          null,
          false,
          2,
        ]);
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
              llm_turn_count: null,
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
              llm_turn_count: null,
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

  it('includes linked-target workflow briefs when a scoped task or work item is selected', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_operator_briefs')) {
        expect(sql).toContain('linked_target_ids @>');
        expect(sql).toContain('LIMIT $8');
        expect(params).toEqual([
          'tenant-1',
          'workflow-1',
          'work-item-7',
          'work-item-7',
          'task-4',
          'task-4',
          false,
          5,
        ]);
        return {
          rowCount: 1,
          rows: [
            {
              id: 'brief-linked',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: null,
              task_id: null,
              request_id: 'request-linked',
              execution_context_id: 'activation-1',
              brief_kind: 'milestone',
              brief_scope: 'workflow_timeline',
              source_kind: 'orchestrator',
              source_role_name: 'Orchestrator',
              llm_turn_count: null,
              status_kind: 'handoff',
              short_brief: { headline: 'Linked brief' },
              detailed_brief_json: { headline: 'Linked brief', status_kind: 'handoff' },
              linked_target_ids: ['workflow-1', 'work-item-7', 'task-4'],
              sequence_number: 6,
              related_artifact_ids: [],
              related_output_descriptor_ids: [],
              related_intervention_ids: [],
              canonical_workflow_brief_id: null,
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: new Date('2026-03-27T19:00:00.000Z'),
              updated_at: new Date('2026-03-27T19:00:00.000Z'),
            },
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.listBriefs('tenant-1', 'workflow-1', {
      workItemId: 'work-item-7',
      taskId: 'task-4',
      limit: 5,
    });

    expect(result.map((entry) => entry.id)).toEqual(['brief-linked']);
  });

  it('lists workflow deliverable briefs across work-item scope when rollup is requested', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_operator_briefs')) {
        expect(sql).not.toContain('($3::uuid IS NULL AND $5::uuid IS NULL)');
        expect(sql).toContain('ORDER BY sequence_number DESC');
        expect(params).toEqual([
          'tenant-1',
          'workflow-1',
          10,
        ]);
        return {
          rowCount: 2,
          rows: [
            {
              id: 'brief-work-item',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              task_id: null,
              request_id: 'request-work-item',
              execution_context_id: 'execution-work-item',
              brief_kind: 'milestone',
              brief_scope: 'deliverable_context',
              source_kind: 'specialist',
              source_role_name: 'Verifier',
              llm_turn_count: null,
              status_kind: 'completed',
              short_brief: { headline: 'Work-item packet' },
              detailed_brief_json: { headline: 'Work-item packet', status_kind: 'completed' },
              linked_target_ids: ['work-item-1'],
              sequence_number: 2,
              related_artifact_ids: [],
              related_output_descriptor_ids: [],
              related_intervention_ids: [],
              canonical_workflow_brief_id: null,
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: new Date('2026-03-27T19:00:00.000Z'),
              updated_at: new Date('2026-03-27T19:00:00.000Z'),
            },
            {
              id: 'brief-workflow',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: null,
              task_id: null,
              request_id: 'request-workflow',
              execution_context_id: 'execution-workflow',
              brief_kind: 'milestone',
              brief_scope: 'deliverable_context',
              source_kind: 'orchestrator',
              source_role_name: 'Orchestrator',
              llm_turn_count: null,
              status_kind: 'completed',
              short_brief: { headline: 'Workflow packet' },
              detailed_brief_json: { headline: 'Workflow packet', status_kind: 'completed' },
              linked_target_ids: ['workflow-1'],
              sequence_number: 1,
              related_artifact_ids: [],
              related_output_descriptor_ids: [],
              related_intervention_ids: [],
              canonical_workflow_brief_id: null,
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: new Date('2026-03-27T18:00:00.000Z'),
              updated_at: new Date('2026-03-27T18:00:00.000Z'),
            },
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.listBriefs('tenant-1', 'workflow-1', {
      includeAllWorkItemScopes: true,
      limit: 10,
    });

    expect(result.map((entry) => entry.id)).toEqual(['brief-work-item', 'brief-workflow']);
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
        expect(params?.[18]).toBeNull();
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
            llm_turn_count: null,
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
            llm_turn_count: null,
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
        expect(params?.[18]).toBeNull();
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
            llm_turn_count: null,
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
        expect(params?.[18]).toBeNull();
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
            llm_turn_count: null,
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

  it('defaults completed task outputs into deliverable_context even without linked descriptors', async () => {
    deliverableService.upsertDeliverable.mockResolvedValue({
      descriptor_id: 'descriptor-8',
    });
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM tasks')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-3',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-3',
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
        return { rowCount: 1, rows: [{ id: 'work-item-3' }] };
      }
      if (sql.includes('COALESCE(MAX(sequence_number), 0) + 1')) {
        return { rowCount: 1, rows: [{ next_sequence: 8 }] };
      }
      if (sql.includes('INSERT INTO workflow_operator_briefs')) {
        expect(params?.[8]).toBe('deliverable_context');
        expect(params?.[12]).toBe('completed');
        expect(params?.[18]).toBeNull();
        return {
          rowCount: 1,
          rows: [{
            id: 'brief-8',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-3',
            task_id: 'task-3',
            request_id: params?.[5],
            execution_context_id: 'task-3',
            brief_kind: 'milestone',
            brief_scope: 'deliverable_context',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            llm_turn_count: null,
            status_kind: 'completed',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            linked_target_ids: [],
            sequence_number: 8,
            related_artifact_ids: [],
            related_output_descriptor_ids: [],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T03:00:00.000Z'),
            updated_at: new Date('2026-03-28T03:00:00.000Z'),
          }],
        };
      }
      if (sql.includes('FROM workflow_output_descriptors') && sql.includes('source_brief_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM workflow_artifacts')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', []]);
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('UPDATE workflow_operator_briefs')) {
        expect(params?.[0]).toBe(JSON.stringify(['descriptor-8']));
        return {
          rowCount: 1,
          rows: [{
            id: 'brief-8',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-3',
            task_id: 'task-3',
            request_id: 'request-8',
            execution_context_id: 'task-3',
            brief_kind: 'milestone',
            brief_scope: 'deliverable_context',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            llm_turn_count: null,
            status_kind: 'completed',
            short_brief: { headline: 'Final packet is complete.' },
            detailed_brief_json: {
              headline: 'Final packet is complete.',
              status_kind: 'completed',
              summary: 'The only deliverable published for this task is the brief itself.',
            },
            linked_target_ids: [],
            sequence_number: 8,
            related_artifact_ids: [],
            related_output_descriptor_ids: ['descriptor-8'],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T03:00:00.000Z'),
            updated_at: new Date('2026-03-28T03:00:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordBriefWrite(IDENTITY as never, 'workflow-1', {
      executionContextId: 'task-3',
      workItemId: 'work-item-3',
      taskId: 'task-3',
      payload: {
        shortBrief: {
          headline: 'Final packet is complete.',
        },
        detailedBriefJson: {
          headline: 'Final packet is complete.',
          status_kind: 'completed',
          summary: 'The only deliverable published for this task is the brief itself.',
        },
      },
    } as never);

    expect(result.record.brief_scope).toBe('deliverable_context');
    expect(result.record.status_kind).toBe('completed');
    expect(result.record.related_output_descriptor_ids).toEqual(['descriptor-8']);
    const synthesizedDeliverable = deliverableService.upsertDeliverable.mock.calls[0]?.[2];
    expect(deliverableService.upsertDeliverable).toHaveBeenCalledWith(
      IDENTITY,
      'workflow-1',
      expect.objectContaining({
        descriptorKind: 'brief_packet',
        deliveryStage: 'final',
        primaryTarget: expect.objectContaining({ target_kind: 'inline_summary' }),
        sourceBriefId: 'brief-8',
      }),
    );
    expect(synthesizedDeliverable?.primaryTarget).not.toHaveProperty('url');
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
          rows: [{
            id: 'brief-9',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-9',
            task_id: 'task-9',
            request_id: params?.[5],
            execution_context_id: 'task-9',
            brief_kind: 'milestone',
            brief_scope: 'deliverable_context',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            llm_turn_count: null,
            status_kind: 'completed',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            linked_target_ids: [],
            sequence_number: 9,
            related_artifact_ids: ['artifact-9'],
            related_output_descriptor_ids: [],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T09:00:00.000Z'),
            updated_at: new Date('2026-03-28T09:00:00.000Z'),
          }],
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
          rows: [{
            id: 'brief-9',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-9',
            task_id: 'task-9',
            request_id: 'request-9',
            execution_context_id: 'task-9',
            brief_kind: 'milestone',
            brief_scope: 'deliverable_context',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            llm_turn_count: null,
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
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T09:00:00.000Z'),
            updated_at: new Date('2026-03-28T09:00:00.000Z'),
          }],
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
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
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
          rows: [{
            id: 'brief-10',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-10',
            task_id: 'task-10',
            request_id: 'request-10',
            execution_context_id: 'task-10',
            brief_kind: 'milestone',
            brief_scope: 'deliverable_context',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            llm_turn_count: null,
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
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T10:00:00.000Z'),
            updated_at: new Date('2026-03-28T10:00:00.000Z'),
          }],
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
          rows: [{
            id: 'brief-10',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-10',
            task_id: 'task-10',
            request_id: 'request-10',
            execution_context_id: 'task-10',
            brief_kind: 'milestone',
            brief_scope: 'deliverable_context',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            llm_turn_count: null,
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
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T10:00:00.000Z'),
            updated_at: new Date('2026-03-28T10:00:00.000Z'),
          }],
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
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
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
          rows: [{
            id: 'brief-11',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-11',
            task_id: 'task-11',
            request_id: 'request-11',
            execution_context_id: 'task-11',
            brief_kind: 'milestone',
            brief_scope: 'deliverable_context',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            llm_turn_count: null,
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
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T11:00:00.000Z'),
            updated_at: new Date('2026-03-28T11:00:00.000Z'),
          }],
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
          rows: [{
            id: 'brief-11',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-11',
            task_id: 'task-11',
            request_id: 'request-11',
            execution_context_id: 'task-11',
            brief_kind: 'milestone',
            brief_scope: 'deliverable_context',
            source_kind: 'specialist',
            source_role_name: 'Writer',
            llm_turn_count: null,
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
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T11:00:00.000Z'),
            updated_at: new Date('2026-03-28T11:00:00.000Z'),
          }],
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

  it('materializes a work-item deliverable packet from an orchestrator brief that only links to a work item target', async () => {
    deliverableService.upsertDeliverable.mockResolvedValue({
      descriptor_id: 'descriptor-12',
    });
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
          rows: [{
            id: 'brief-12',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            task_id: null,
            request_id: params?.[5],
            execution_context_id: 'activation-11',
            brief_kind: 'milestone',
            brief_scope: 'deliverable_context',
            source_kind: 'orchestrator',
            source_role_name: 'Orchestrator',
            llm_turn_count: null,
            status_kind: 'completed',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            linked_target_ids: ['work-item-11', 'task-11'],
            sequence_number: 12,
            related_artifact_ids: [],
            related_output_descriptor_ids: [],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T12:00:00.000Z'),
            updated_at: new Date('2026-03-28T12:00:00.000Z'),
          }],
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
        expect(params?.[0]).toBe(JSON.stringify(['descriptor-12']));
        expect(params?.[2]).toBe('tenant-1');
        expect(params?.[3]).toBe('workflow-1');
        expect(params?.[4]).toBe('brief-12');
        return {
          rowCount: 1,
          rows: [{
            id: 'brief-12',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            task_id: null,
            request_id: 'request-12',
            execution_context_id: 'activation-11',
            brief_kind: 'milestone',
            brief_scope: 'deliverable_context',
            source_kind: 'orchestrator',
            source_role_name: 'Orchestrator',
            llm_turn_count: null,
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
            related_artifact_ids: [],
            related_output_descriptor_ids: ['descriptor-12'],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T12:00:00.000Z'),
            updated_at: new Date('2026-03-28T12:00:00.000Z'),
          }],
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
    expect(result.record.related_output_descriptor_ids).toEqual(['descriptor-12']);
    expect(deliverableService.upsertDeliverable).toHaveBeenCalledWith(
      IDENTITY,
      'workflow-1',
      expect.objectContaining({
        descriptorKind: 'brief_packet',
        workItemId: 'work-item-11',
        sourceBriefId: 'brief-12',
      }),
    );
  });

  it('persists llm turn count on recorded operator briefs', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM tasks')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'task-4',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-4',
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
        return { rowCount: 1, rows: [{ id: 'work-item-4' }] };
      }
      if (sql.includes('COALESCE(MAX(sequence_number), 0) + 1')) {
        return { rowCount: 1, rows: [{ next_sequence: 9 }] };
      }
      if (sql.includes('INSERT INTO workflow_operator_briefs')) {
        expect(params?.[18]).toBe(5);
        return {
          rowCount: 1,
          rows: [{
            id: 'brief-9',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-4',
            task_id: 'task-4',
            request_id: 'request-9',
            execution_context_id: 'task-4',
            brief_kind: 'milestone',
            brief_scope: 'workflow_timeline',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            llm_turn_count: 5,
            status_kind: 'completed',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            linked_target_ids: [],
            sequence_number: 9,
            related_artifact_ids: [],
            related_output_descriptor_ids: [],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-28T03:10:00.000Z'),
            updated_at: new Date('2026-03-28T03:10:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordBriefWrite(IDENTITY as never, 'workflow-1', {
      requestId: 'request-9',
      executionContextId: 'task-4',
      workItemId: 'work-item-4',
      taskId: 'task-4',
      llmTurnCount: 5,
      briefKind: 'milestone',
      briefScope: 'workflow_timeline',
      sourceKind: 'specialist',
      payload: {
        shortBrief: {
          headline: 'Verifier closed the review loop.',
        },
        detailedBriefJson: {
          headline: 'Verifier closed the review loop.',
          status_kind: 'completed',
          summary: 'The review completed successfully.',
        },
      },
    });

    expect(result.record.llm_turn_count).toBe(5);
  });
});
