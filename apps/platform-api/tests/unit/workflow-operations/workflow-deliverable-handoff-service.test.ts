import { describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverableHandoffService } from '../../../src/services/workflow-deliverable-handoff-service.js';

describe('WorkflowDeliverableHandoffService', () => {
  it('lists the latest completed work-item handoffs with normalized optional fields', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: 'handoff-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            role: 'policy-assessor',
            summary: 'workflow-intake-01 is approved and ready to remain open.',
            completion: 'Approved the intake packet.',
            completion_state: 'completed',
            resolution: 'approved',
            decision_state: 'approved',
            created_at: new Date('2026-03-28T20:20:00.000Z'),
            work_item_title: 'workflow-intake-01',
          },
        ],
      })),
    };

    const service = new WorkflowDeliverableHandoffService(pool as never);
    const result = await service.listLatestCompletedWorkItemHandoffs('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
    });

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        id: 'handoff-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: 'task-1',
        role: 'policy-assessor',
        summary: 'workflow-intake-01 is approved and ready to remain open.',
        completion: 'Approved the intake packet.',
        completion_state: 'completed',
        resolution: 'approved',
        decision_state: 'approved',
        created_at: '2026-03-28T20:20:00.000Z',
        work_item_title: 'workflow-intake-01',
      },
    ]);
  });
});
