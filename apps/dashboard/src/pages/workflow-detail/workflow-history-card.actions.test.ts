import { describe, expect, it } from 'vitest';

import { buildTimelineEntryActions } from './workflow-history-card.actions.js';

describe('workflow history timeline actions', () => {
  it('routes board-owned activity through the work-item flow first', () => {
    expect(
      buildTimelineEntryActions({
        activationId: 'activation-3',
        childWorkflowHref: '/mission-control/workflows/workflow-child-2',
        childWorkflowId: 'workflow-child-2',
        gateStageName: 'design',
        workflowId: 'workflow-1',
        workItemId: 'work-item-7',
        taskId: 'task-9',
      }),
    ).toEqual([
      {
        label: 'Open work item flow',
        href: '/mission-control/workflows/workflow-1?work_item=work-item-7',
      },
      {
        label: 'Open gate focus',
        href: '/mission-control/workflows/workflow-1?gate=design#gate-design',
      },
      {
        label: 'Open activation packet',
        href: '/mission-control/workflows/workflow-1?activation=activation-3#activation-activation-3',
      },
      {
        label: 'Open child board',
        href: '/mission-control/workflows/workflow-child-2',
      },
      {
        label: 'Open step diagnostics',
        href: '/mission-control/tasks/task-9',
      },
    ]);
  });

  it('keeps workflow-scoped step links in diagnostics mode even without work-item context', () => {
    expect(
      buildTimelineEntryActions({
        activationId: null,
        childWorkflowHref: null,
        childWorkflowId: null,
        gateStageName: null,
        workflowId: 'workflow-1',
        workItemId: null,
        taskId: 'task-9',
      }),
    ).toEqual([
      {
        label: 'Open step diagnostics',
        href: '/mission-control/tasks/task-9',
      },
    ]);
  });
});
