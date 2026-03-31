import { describe, expect, it } from 'vitest';

import {
  createReopenScenarioClient,
  createTaskLifecycleService,
  identity,
} from './support.js';

describe('TaskLifecycleService work item reopen routing', () => {
  it('reopens a terminal-lane work item even when completed_at is still null', async () => {
    const client = createReopenScenarioClient({
      taskId: 'task-review-terminal-lane',
      feedback: 'Rework the item.',
      workflowState: 'active',
      workflowMetadata: {},
      completedAt: null,
      reopenColumnId: 'active',
      engagedTaskCount: 1,
    });
    const service = createTaskLifecycleService(client);

    await service.requestTaskChanges(identity, 'task-review-terminal-lane', {
      feedback: 'Rework the item.',
    });

    const reopenCall = client.query.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string'
        && sql.includes('UPDATE workflow_work_items')
        && sql.includes('(completed_at IS NOT NULL OR column_id = $5)'),
    ) as [string, unknown[]] | undefined;

    expect(reopenCall?.[1]).toEqual(['tenant-1', 'workflow-1', 'work-item-1', 'active', 'done']);
  });
});
