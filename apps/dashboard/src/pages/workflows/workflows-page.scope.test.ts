import { describe, expect, it } from 'vitest';

import {
  buildRepeatWorkflowLaunchSeed,
  describeHeaderAddWorkLabel,
  describeWorkflowWorkbenchScope,
  resolveHeaderAddWorkTargetWorkItemId,
  resolveWorkflowTabScope,
} from './workflows-page.support.js';

describe('workflows page scope support', () => {
  it('uses workflow or work-item scope only across every workbench tab', () => {
    expect(resolveWorkflowTabScope('details', 'work-item-7')).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('needs_action', 'work-item-7')).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('live_console', 'work-item-7')).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('deliverables', 'work-item-7')).toBe('selected_work_item');
    expect(resolveWorkflowTabScope('live_console', null)).toBe('workflow');
  });

  it('opens header add-or-modify in modify mode only for explicit work-item scope', () => {
    expect(
      resolveHeaderAddWorkTargetWorkItemId({
        scopeKind: 'selected_work_item',
        workItemId: 'work-item-7',
      }),
    ).toBe('work-item-7');
    expect(
      resolveHeaderAddWorkTargetWorkItemId({
        scopeKind: 'workflow',
        workItemId: 'work-item-7',
      }),
    ).toBeNull();
  });

  it('describes the header add-work label from the active scope and lifecycle', () => {
    expect(
      describeHeaderAddWorkLabel({
        scopeKind: 'selected_work_item',
        lifecycle: 'ongoing',
      }),
    ).toBe('Modify Work');
    expect(
      describeHeaderAddWorkLabel({
        scopeKind: 'workflow',
        lifecycle: 'planned',
      }),
    ).toBe('Add Work');
  });

  it('builds a terminal repeat launch seed from the completed workflow context only', () => {
    expect(
      buildRepeatWorkflowLaunchSeed({
        workflowState: 'completed',
        playbookId: 'playbook-1',
        workspaceId: 'workspace-1',
        workItemTitle: 'Publish terminal brief',
        workflowParameters: {
          workflow_goal: 'Publish a terminal brief with deliverables.',
        },
      }),
    ).toEqual({
      playbookId: 'playbook-1',
      workspaceId: 'workspace-1',
      workflowName: 'Publish terminal brief',
      parameterDrafts: {
        workflow_goal: 'Publish a terminal brief with deliverables.',
      },
    });
    expect(
      buildRepeatWorkflowLaunchSeed({
        workflowState: 'active',
        playbookId: 'playbook-1',
        workspaceId: 'workspace-1',
        workItemTitle: 'Publish terminal brief',
        workflowParameters: {
          workflow_goal: 'Publish a terminal brief with deliverables.',
        },
      }),
    ).toBeNull();
  });

  it('describes the exact shell scope banner for workflow and work item views only', () => {
    expect(
      describeWorkflowWorkbenchScope({
        scopeKind: 'workflow',
        workflowName: 'Release Workflow',
        workItemId: null,
        workItemTitle: null,
      }),
    ).toMatchObject({
      scopeKind: 'workflow',
      title: 'Workflow',
      subject: 'workflow',
      banner: 'Workflow · Release Workflow',
    });
    expect(
      describeWorkflowWorkbenchScope({
        scopeKind: 'selected_work_item',
        workflowName: 'Release Workflow',
        workItemId: 'work-item-7',
        workItemTitle: 'Prepare release bundle',
      }),
    ).toMatchObject({
      scopeKind: 'selected_work_item',
      title: 'Work item',
      subject: 'work item',
      banner: 'Work item · Prepare release bundle',
    });
  });

  it('describes explicit selected work-item scope without any task lens semantics', () => {
    expect(
      describeWorkflowWorkbenchScope({
        scopeKind: 'selected_work_item',
        workflowName: 'Release Workflow',
        workItemId: 'work-item-7',
        workItemTitle: 'Prepare release bundle',
      }),
    ).toMatchObject({
      scopeKind: 'selected_work_item',
      title: 'Work item',
      subject: 'work item',
      banner: 'Work item · Prepare release bundle',
    });
  });
});
