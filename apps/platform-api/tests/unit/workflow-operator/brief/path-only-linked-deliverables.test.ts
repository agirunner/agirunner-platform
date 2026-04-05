import { beforeEach, describe, expect, it } from 'vitest';

import {
  IDENTITY,
  createWorkflowOperatorBriefRow,
  createWorkflowOperatorBriefServiceTestContext,
} from './support.js';

describe('WorkflowOperatorBriefService path-only linked deliverables', () => {
  let pool: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['pool'];
  let service: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['service'];
  let deliverableService: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['deliverableService'];

  beforeEach(() => {
    ({ pool, service, deliverableService } = createWorkflowOperatorBriefServiceTestContext());
  });

  it('does not materialize workflow deliverables from path-only linked placeholders', async () => {
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
            id: 'activation-21',
            workflow_id: 'workflow-1',
            activation_id: 'activation-21',
            state: 'running',
            consumed_at: null,
          }],
        };
      }
      if (sql.includes('FROM workflow_operator_briefs') && sql.includes('request_id = $3')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('COALESCE(MAX(sequence_number), 0) + 1')) {
        return { rowCount: 1, rows: [{ next_sequence: 21 }] };
      }
      if (sql.includes('INSERT INTO workflow_operator_briefs')) {
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-21',
            request_id: params?.[5] as string,
            execution_context_id: 'activation-21',
            source_kind: 'orchestrator',
            source_role_name: 'Orchestrator',
            brief_scope: 'deliverable_context',
            status_kind: 'completed',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            linked_target_ids: [],
            sequence_number: 21,
            created_at: new Date('2026-04-05T17:12:01.629Z'),
            updated_at: new Date('2026-04-05T17:12:01.629Z'),
          })],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.recordBriefWrite(IDENTITY as never, 'workflow-1', {
      requestId: 'request-21',
      executionContextId: 'activation-21',
      sourceKind: 'orchestrator',
      briefScope: 'deliverable_context',
      statusKind: 'completed',
      payload: {
        shortBrief: {
          headline: 'Final recommendation recorded: do not merge yet',
        },
        detailedBriefJson: {
          headline: 'Final recommendation recorded: do not merge yet',
          status_kind: 'completed',
          summary: 'Resolve blockers before reopening merge review.',
        },
        linkedDeliverables: [
          {
            descriptorKind: 'deliverable_packet',
            deliveryStage: 'final',
            title: 'Final merge recommendation',
            state: 'final',
            previewCapabilities: {
              can_inline_preview: true,
              can_download: false,
              can_open_external: false,
              can_copy_path: true,
              preview_kind: 'structured_summary',
            },
            primaryTarget: {
              target_kind: 'inline_summary',
              label: 'Final merge recommendation',
              path: 'docs/reviews/export-stabilization-final-recommendation.md',
            },
            secondaryTargets: [],
            contentPreview: {
              summary: 'Path: docs/reviews/export-stabilization-final-recommendation.md',
            },
          },
        ],
      },
    } as never);

    expect(result.record.related_output_descriptor_ids).toEqual([]);
    expect(deliverableService.upsertDeliverable).not.toHaveBeenCalled();
  });
});
