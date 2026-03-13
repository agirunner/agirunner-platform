import { describe, expect, it } from 'vitest';

import { buildTimelineEntryActions } from './workflow-history-card.actions.js';

describe('workflow history timeline actions', () => {
  it('routes board-owned activity through the work-item flow first', () => {
    expect(
      buildTimelineEntryActions({
        workflowId: 'workflow-1',
        workItemId: 'work-item-7',
        taskId: 'task-9',
      }),
    ).toEqual([
      {
        label: 'Open work item flow',
        href: '/work/workflows/workflow-1?work_item=work-item-7',
      },
      {
        label: 'Open step diagnostics',
        href: '/work/tasks/task-9',
      },
    ]);
  });

  it('falls back to a direct step record only when no work-item context exists', () => {
    expect(
      buildTimelineEntryActions({
        workflowId: 'workflow-1',
        workItemId: null,
        taskId: 'task-9',
      }),
    ).toEqual([
      {
        label: 'Open step record',
        href: '/work/tasks/task-9',
      },
    ]);
  });
});
