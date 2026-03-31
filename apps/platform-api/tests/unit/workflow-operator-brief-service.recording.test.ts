import { beforeEach, describe, expect, it } from 'vitest';

import { IDENTITY, createWorkflowOperatorBriefRow, createWorkflowOperatorBriefServiceTestContext } from './workflow-operator-brief-service.test-support.js';

describe('WorkflowOperatorBriefService recording', () => {
  let pool: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['pool'];
  let service: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['service'];
  let deliverableService: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['deliverableService'];

  beforeEach(() => {
    ({ pool, service, deliverableService } = createWorkflowOperatorBriefServiceTestContext());
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
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'request-1',
            execution_context_id: 'task-1',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            status_kind: 'in_progress',
            short_brief: { headline: 'Existing brief' },
            detailed_brief_json: { headline: 'Existing brief', status_kind: 'in_progress' },
            sequence_number: 3,
          })],
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
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-6',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'request-6',
            execution_context_id: 'task-1',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            brief_scope: 'work_item_handoff',
            status_kind: 'handoff',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            sequence_number: 6,
            created_at: new Date('2026-03-28T01:00:00.000Z'),
            updated_at: new Date('2026-03-28T01:00:00.000Z'),
          })],
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
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-7',
            work_item_id: 'work-item-2',
            task_id: 'task-2',
            request_id: params?.[5] as string,
            execution_context_id: 'task-2',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            brief_scope: 'work_item_handoff',
            status_kind: 'handoff',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            sequence_number: 7,
            created_at: new Date('2026-03-28T02:00:00.000Z'),
            updated_at: new Date('2026-03-28T02:00:00.000Z'),
          })],
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
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-9',
            work_item_id: 'work-item-4',
            task_id: 'task-4',
            request_id: 'request-9',
            execution_context_id: 'task-4',
            source_kind: 'specialist',
            source_role_name: 'Verifier',
            brief_scope: 'workflow_timeline',
            status_kind: 'completed',
            llm_turn_count: 5,
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            sequence_number: 9,
            created_at: new Date('2026-03-28T03:10:00.000Z'),
            updated_at: new Date('2026-03-28T03:10:00.000Z'),
          })],
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
