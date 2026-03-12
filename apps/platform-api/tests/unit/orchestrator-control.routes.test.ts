import { describe, expect, it, vi } from 'vitest';

import { normalizeOrchestratorChildWorkflowLinkage } from '../../src/api/routes/orchestrator-control.routes.js';

describe('normalizeOrchestratorChildWorkflowLinkage', () => {
  it('backfills normalized parent-child metadata on both workflows without duplicating child ids', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ metadata: { child_workflow_ids: ['wf-child-1'] } }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ metadata: { existing: true } }],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };

    await normalizeOrchestratorChildWorkflowLinkage(
      pool as never,
      'tenant-1',
      {
        parentWorkflowId: 'wf-parent',
        parentOrchestratorTaskId: 'task-orch-1',
        parentOrchestratorActivationId: 'activation-1',
        parentWorkItemId: 'wi-1',
        parentStageName: 'implementation',
        parentContext: 'Use the shared repo state.',
      },
      'wf-child-1',
    );

    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE workflows'),
      [
        'tenant-1',
        'wf-parent',
        {
          child_workflow_ids: ['wf-child-1'],
          latest_child_workflow_id: 'wf-child-1',
          latest_child_workflow_created_by_orchestrator_task_id: 'task-orch-1',
        },
      ],
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('UPDATE workflows'),
      [
        'tenant-1',
        'wf-child-1',
        {
          existing: true,
          parent_workflow_id: 'wf-parent',
          parent_orchestrator_task_id: 'task-orch-1',
          parent_orchestrator_activation_id: 'activation-1',
          parent_work_item_id: 'wi-1',
          parent_stage_name: 'implementation',
          parent_context: 'Use the shared repo state.',
          parent_link_kind: 'orchestrator_child',
        },
      ],
    );
  });
});
