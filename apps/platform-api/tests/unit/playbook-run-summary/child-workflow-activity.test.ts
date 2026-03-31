import { describe, expect, it } from 'vitest';

import { buildPlaybookRunSummary } from '../../../src/services/playbook-run-summary.js';

describe('buildPlaybookRunSummary', () => {
  it('counts direct child workflow events alongside activation-backed child workflow transitions', () => {
    const summary = buildPlaybookRunSummary({
      workflow: {
        id: 'wf-parent-1',
        name: 'Parent workflow',
        lifecycle: 'planned',
        state: 'active',
        created_at: '2026-03-10T00:00:00.000Z',
        started_at: '2026-03-10T00:05:00.000Z',
        completed_at: null,
        metadata: {
          child_workflow_ids: ['wf-child-1', 'wf-child-2'],
          latest_child_workflow_id: 'wf-child-2',
        },
      },
      tasks: [],
      stages: [],
      workItems: [],
      events: [
        {
          type: 'workflow.activation_queued',
          actor_type: 'system',
          actor_id: 'dispatcher',
          data: {
            activation_id: 'activation-1',
            event_type: 'child_workflow.completed',
            child_workflow_id: 'wf-child-1',
            child_workflow_state: 'completed',
          },
          created_at: new Date('2026-03-10T00:06:00.000Z'),
        },
        {
          type: 'child_workflow.failed',
          actor_type: 'system',
          actor_id: 'workflow_state_deriver',
          data: {
            parent_workflow_id: 'wf-parent-1',
            child_workflow_id: 'wf-child-2',
            child_workflow_state: 'failed',
            outcome: { state: 'failed', task_count: 2, failed_task_count: 1 },
          },
          created_at: new Date('2026-03-10T00:07:00.000Z'),
        },
      ],
      artifacts: [],
    });

    expect(summary.child_workflow_activity).toEqual(
      expect.objectContaining({
        child_workflow_count: 2,
        completion_event_count: 1,
        failure_event_count: 1,
        latest_child_workflow_id: 'wf-child-2',
        transitions: [
          expect.objectContaining({
            activation_id: 'activation-1',
            event_type: 'child_workflow.completed',
            child_workflow_id: 'wf-child-1',
          }),
          expect.objectContaining({
            activation_id: null,
            event_type: 'child_workflow.failed',
            child_workflow_id: 'wf-child-2',
          }),
        ],
      }),
    );
  });
});
