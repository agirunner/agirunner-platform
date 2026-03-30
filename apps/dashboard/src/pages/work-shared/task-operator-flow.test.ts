import { describe, expect, it } from 'vitest';

import {
  buildWorkflowOperatorPermalink,
  readWorkflowOperatorFlowLabel,
  usesWorkflowOperatorFlow,
  usesWorkItemOperatorFlow,
} from './task-operator-flow.js';

describe('task operator flow routing', () => {
  it('treats work-item-scoped workflow steps as grouped work-item flow', () => {
    const task = {
      workflow_id: 'wf-1',
      work_item_id: 'wi-1',
      activation_id: 'activation-1',
    };

    expect(usesWorkItemOperatorFlow(task)).toBe(true);
    expect(usesWorkflowOperatorFlow(task)).toBe(true);
    expect(readWorkflowOperatorFlowLabel(task)).toBe('Grouped work-item operator flow');
    expect(buildWorkflowOperatorPermalink(task)).toBe(
      '/workflows/wf-1?work_item_id=wi-1&tab=live_console#work-item-wi-1',
    );
  });

  it('routes stage-scoped workflow steps into board stage context even without a work item id', () => {
    const task = {
      workflow_id: 'wf-2',
      stage_name: 'qa-review',
      activation_id: 'activation-9',
    };

    expect(usesWorkItemOperatorFlow(task)).toBe(false);
    expect(usesWorkflowOperatorFlow(task)).toBe(true);
    expect(readWorkflowOperatorFlowLabel(task)).toBe('Workflow-linked step context');
    expect(buildWorkflowOperatorPermalink(task)).toBe(
      '/workflows/wf-2?tab=needs_action#gate-qa-review',
    );
  });

  it('leaves standalone tasks on the direct operator decision path', () => {
    const task = {};

    expect(usesWorkflowOperatorFlow(task)).toBe(false);
    expect(readWorkflowOperatorFlowLabel(task)).toBe('Direct operator decision');
    expect(buildWorkflowOperatorPermalink(task)).toBeNull();
  });
});
