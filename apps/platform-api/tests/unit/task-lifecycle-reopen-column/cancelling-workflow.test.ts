import { describe, expect, it } from 'vitest';

import {
  createReopenScenarioClient,
  createTaskLifecycleService,
  identity,
} from './support.js';

describe('TaskLifecycleService work item reopen routing', () => {
  it('preserves the current board column when request-changes reopens a cancelling workflow work item', async () => {
    const client = createReopenScenarioClient({
      taskId: 'task-review-cancelling-reopen',
      feedback: 'Keep the work parked in its current lane while cancellation settles.',
      workflowState: 'active',
      workflowMetadata: { cancel_requested_at: '2026-03-21T02:06:00Z' },
      completedAt: new Date('2026-03-21T02:05:00Z'),
      reopenColumnId: 'done',
      engagedTaskCount: 0,
    });
    const service = createTaskLifecycleService(client);

    await service.requestTaskChanges(identity, 'task-review-cancelling-reopen', {
      feedback: 'Keep the work parked in its current lane while cancellation settles.',
    });

    const reopenCall = client.query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string'
        && sql.includes('UPDATE workflow_work_items')
        && sql.includes('SET column_id = $4')
        && sql.includes('completed_at = NULL')
        && sql.includes('id = $3')
        && sql.includes('(completed_at IS NOT NULL OR column_id = $5)'),
    ) as [string, unknown[]] | undefined;

    expect(reopenCall?.[1]).toEqual(['tenant-1', 'workflow-1', 'work-item-1', 'done', 'done']);
  });
});
