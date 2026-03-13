import { describe, expect, it } from 'vitest';

import { buildAttentionTaskActions } from './live-board-attention-actions.js';

describe('live board attention actions', () => {
  it('routes board-owned steps through the work-item flow before diagnostics', () => {
    expect(
      buildAttentionTaskActions({
        taskId: 'task-1',
        workflowId: 'workflow-1',
        workItemId: 'work-item-1',
        activationId: 'activation-1',
        state: 'failed',
      }),
    ).toEqual([
      {
        label: 'Open work-item flow',
        href: '/work/workflows/workflow-1?work_item=work-item-1&activation=activation-1',
        isPrimary: true,
      },
      {
        label: 'Open failed step diagnostics',
        href: '/work/tasks/task-1',
        isPrimary: false,
      },
    ]);
  });

  it('falls back to board context or raw step detail when work-item context is absent', () => {
    expect(
      buildAttentionTaskActions({
        taskId: 'task-2',
        workflowId: 'workflow-2',
        state: 'awaiting_approval',
      }),
    ).toEqual([
      {
        label: 'Open board context',
        href: '/work/workflows/workflow-2',
        isPrimary: true,
      },
      {
        label: 'Open step diagnostics',
        href: '/work/tasks/task-2',
        isPrimary: false,
      },
    ]);

    expect(
      buildAttentionTaskActions({
        taskId: 'task-3',
      }),
    ).toEqual([
      {
        label: 'Open step record',
        href: '/work/tasks/task-3',
        isPrimary: false,
      },
    ]);
  });
});
