import { describe, expect, it } from 'vitest';

import { buildTimelineEntryActions } from './workflow-history-card.actions.js';

describe('workflow history timeline actions', () => {
  it('routes board-owned activity through the work-item flow first', () => {
    expect(
      buildTimelineEntryActions({
        activationId: 'activation-3',
        childWorkflowHref: '/work/boards/workflow-child-2',
        childWorkflowId: 'workflow-child-2',
        gateStageName: 'design',
        workflowId: 'workflow-1',
        workItemId: 'work-item-7',
        taskId: 'task-9',
      }),
    ).toEqual([
      {
        label: 'Open work item flow',
        href: '/work/boards/workflow-1?work_item=work-item-7',
      },
      {
        label: 'Open gate focus',
        href: '/work/boards/workflow-1?gate=design#gate-design',
      },
      {
        label: 'Open activation packet',
        href: '/work/boards/workflow-1?activation=activation-3#activation-activation-3',
      },
      {
        label: 'Open child board',
        href: '/work/boards/workflow-child-2',
      },
      {
        label: 'Open step diagnostics',
        href: '/work/tasks/task-9',
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
        href: '/work/tasks/task-9',
      },
    ]);
  });
});
