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
        href: '/workflows/workflow-1?work_item_id=work-item-7#work-item-work-item-7',
      },
      {
        label: 'Open gate focus',
        href: '/workflows/workflow-1?tab=needs_action#gate-design',
      },
      {
        label: 'Open activation packet',
        href: '/workflows/workflow-1?tab=live_console#activation-activation-3',
      },
      {
        label: 'Open child board',
        href: '/workflows/workflow-child-2',
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
