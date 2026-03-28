import { describe, expect, it } from 'vitest';

import { buildWorkItemTaskLinkActions } from './workflow-work-item-task-actions.js';

describe('workflow work-item task actions', () => {
  it('keeps work-item flow primary and step detail diagnostic when board context exists', () => {
    expect(
      buildWorkItemTaskLinkActions({
        workflowId: 'workflow-1',
        taskId: 'task-1',
        workItemId: 'work-item-1',
        state: 'failed',
      }),
    ).toEqual([
      {
        label: 'Open work-item flow',
        href: '/workflows/workflow-1?work_item_id=work-item-1#work-item-work-item-1',
        isPrimary: true,
      },
      {
        label: 'Open failed step diagnostics',
        href: '/work/tasks/task-1',
        isPrimary: false,
      },
    ]);
  });

  it('falls back to a raw step record only when no work-item context exists', () => {
    expect(
      buildWorkItemTaskLinkActions({
        workflowId: 'workflow-1',
        taskId: 'task-2',
      }),
    ).toEqual([
      {
        label: 'Open step record',
        href: '/work/tasks/task-2',
        isPrimary: false,
      },
    ]);
  });
});
