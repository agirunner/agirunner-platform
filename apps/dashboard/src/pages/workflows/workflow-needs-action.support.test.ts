import { describe, expect, it } from 'vitest';

import {
  resolveNeedsActionWorkflowTaskContext,
  type WorkflowNeedsActionWorkflowTaskContext,
} from './workspace/workflow-needs-action.support.js';

describe('workflow-needs-action.support', () => {
  it('uses the response work-item id when the platform provides it directly', () => {
    const context = resolveNeedsActionWorkflowTaskContext({
      item: {
        target: {
          target_kind: 'task',
          target_id: 'task-1',
        },
      },
      action: {
        kind: 'approve_task',
        work_item_id: 'work-item-7',
        target: {
          target_kind: 'task',
          target_id: 'task-1',
        },
      },
    });

    expect(context).toEqual<WorkflowNeedsActionWorkflowTaskContext>({
      workItemId: 'work-item-7',
      taskId: 'task-1',
    });
  });

  it('derives the workflow task context from the visible work-item card when the response omits it', () => {
    const context = resolveNeedsActionWorkflowTaskContext({
      item: {
        target: {
          target_kind: 'work_item',
          target_id: 'work-item-9',
        },
      },
      action: {
        kind: 'resolve_escalation',
        target: {
          target_kind: 'task',
          target_id: 'task-4',
        },
      },
    });

    expect(context).toEqual<WorkflowNeedsActionWorkflowTaskContext>({
      workItemId: 'work-item-9',
      taskId: 'task-4',
    });
  });

  it('throws when a workflow-linked task action still has no recoverable work-item context', () => {
    expect(() =>
      resolveNeedsActionWorkflowTaskContext({
        item: {
          target: {
            target_kind: 'task',
            target_id: 'task-2',
          },
        },
        action: {
          kind: 'retry_task',
          target: {
            target_kind: 'task',
            target_id: 'task-2',
          },
        },
      }),
    ).toThrow('Workflow task action is missing work-item context.');
  });
});
