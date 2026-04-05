import { beforeEach, describe, expect, it } from 'vitest';

import { IDENTITY, createWorkflowOperatorBriefRow, createWorkflowOperatorBriefServiceTestContext } from './support.js';

describe('WorkflowOperatorBriefService recording retry', () => {
  let pool: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['pool'];
  let service: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['service'];

  beforeEach(() => {
    ({ pool, service } = createWorkflowOperatorBriefServiceTestContext());
  });

  it('retries a deadlocked operator brief insert and returns the recorded brief', async () => {
    let insertAttempts = 0;

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
            role: 'Software Developer',
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
        insertAttempts += 1;
        if (insertAttempts === 1) {
          const error = new Error('deadlock detected') as Error & { code?: string };
          error.code = '40P01';
          throw error;
        }
        return {
          rowCount: 1,
          rows: [createWorkflowOperatorBriefRow({
            id: 'brief-9',
            work_item_id: 'work-item-9',
            task_id: 'task-9',
            request_id: 'request-9',
            execution_context_id: 'task-9',
            source_kind: 'specialist',
            source_role_name: 'Software Developer',
            brief_scope: 'work_item_handoff',
            status_kind: 'handoff',
            short_brief: JSON.parse(String(params?.[10])),
            detailed_brief_json: JSON.parse(String(params?.[11])),
            sequence_number: 9,
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
      briefKind: 'milestone',
      briefScope: 'work_item_handoff',
      sourceKind: 'specialist',
      payload: {
        shortBrief: {
          headline: 'Implementation packet is ready for the next step.',
        },
        detailedBriefJson: {
          headline: 'Implementation packet is ready for the next step.',
          status_kind: 'handoff',
        },
      },
    } as never);

    expect(insertAttempts).toBe(2);
    expect(result.record_id).toBe('brief-9');
    expect(result.record.status_kind).toBe('handoff');
  });
});
