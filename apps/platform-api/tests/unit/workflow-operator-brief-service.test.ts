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

  beforeEach(() => {
    pool = createPool();
    service = new WorkflowOperatorBriefService(pool as never);
  });

  it('lists workflow operator briefs newest first with optional work-item filtering', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_operator_briefs')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1', 2]);
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

  it('persists short and detailed brief forms with redacted operator-facing content and provenance links', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return { rowCount: 1, rows: [{ id: 'work-item-1' }] };
      }
      if (sql.includes('FROM workflow_operator_briefs') && sql.includes('request_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('COALESCE(MAX(sequence_number), 0) + 1')) {
        return { rowCount: 1, rows: [{ next_sequence: 3 }] };
      }
      if (sql.includes('INSERT INTO workflow_operator_briefs')) {
        expect(params?.[10]).toEqual({
          headline: 'Release package is ready for approval.',
          status_label: 'Needs Action',
          delta_label: 'approval requested',
          next_action_label: 'Approve release',
        });
        expect(params?.[11]).toEqual({
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
        expect(params?.[13]).toEqual(['artifact-1']);
        expect(params?.[14]).toEqual(['descriptor-1']);
        expect(params?.[15]).toEqual(['intervention-1']);
        return {
          rowCount: 1,
          rows: [{
            id: 'brief-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: null,
            request_id: 'request-1',
            execution_context_id: 'execution-1',
            brief_kind: 'milestone',
            brief_scope: 'workflow_timeline',
            source_kind: 'orchestrator',
            source_role_name: 'Orchestrator',
            status_kind: 'in_progress',
            short_brief: params?.[10],
            detailed_brief_json: params?.[11],
            sequence_number: 3,
            related_artifact_ids: ['artifact-1'],
            related_output_descriptor_ids: ['descriptor-1'],
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

    const result = await service.recordBrief(IDENTITY as never, 'workflow-1', {
      requestId: 'request-1',
      executionContextId: 'execution-1',
      workItemId: 'work-item-1',
      briefKind: 'milestone',
      briefScope: 'workflow_timeline',
      sourceKind: 'orchestrator',
      sourceRoleName: 'Orchestrator',
      statusKind: 'in_progress',
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
      relatedArtifactIds: ['artifact-1'],
      relatedOutputDescriptorIds: ['descriptor-1'],
      relatedInterventionIds: ['intervention-1'],
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'brief-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        sequence_number: 3,
        short_brief: expect.objectContaining({
          headline: 'Release package is ready for approval.',
        }),
        detailed_brief_json: expect.objectContaining({
          sections: expect.objectContaining({
            validation: ['redacted://workflow-brief-secret'],
          }),
        }),
      }),
    );
  });
});
