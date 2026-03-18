import { describe, expect, it } from 'vitest';

import { applyLogScope } from './log-scope.js';

describe('applyLogScope', () => {
  it('overlaysWorkflowTaskAndWorkspaceScope', () => {
    expect(
      applyLogScope(
        {
          category: 'tool',
          workflow_id: 'wf-old',
        },
        {
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          taskId: 'task-1',
          workItemId: 'work-item-1',
          activationId: 'activation-1',
        },
      ),
    ).toEqual({
      category: 'tool',
      workspace_id: 'workspace-1',
      workflow_id: 'workflow-1',
      task_id: 'task-1',
      work_item_id: 'work-item-1',
      activation_id: 'activation-1',
    });
  });

  it('returnsExistingParamsWhenScopeIsEmpty', () => {
    expect(applyLogScope({ level: 'error' })).toEqual({ level: 'error' });
  });
});
