import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { WorkflowNeedsAction } from './workflow-needs-action.js';

describe('WorkflowNeedsAction', () => {
  it('renders unresolved approvals and escalations as open action dossiers with inline decision context', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowNeedsAction, {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          scopeSubject: 'work item',
          scopeLabel: 'Work item: Prepare release bundle',
          packet: {
            items: [
              {
                action_id: 'task-approve-1:awaiting_approval',
                action_kind: 'review_work_item',
                label: 'Approval required',
                summary: 'Review release packet is waiting for operator approval.',
                work_item_id: 'work-item-1',
                target: {
                  target_kind: 'task',
                  target_id: 'task-approve-1',
                },
                priority: 'high',
                requires_confirmation: true,
                submission: {
                  route_kind: 'task_mutation',
                  method: 'POST',
                },
                details: [
                  { label: 'Approval target', value: 'Approve release packet' },
                  { label: 'Blocking state', value: 'Waiting on operator sign-off before packaging can continue.' },
                  { label: 'Work so far', value: 'Release packet draft and rollback notes are assembled for sign-off.' },
                  {
                    label: 'Verification',
                    value: 'Release packet verification passed and the required artifacts are attached.',
                  },
                ],
                responses: [
                  {
                    action_id: 'task-approve-1:approve',
                    kind: 'approve_task',
                    label: 'Approve',
                    target: {
                      target_kind: 'task',
                      target_id: 'task-approve-1',
                    },
                    requires_confirmation: false,
                    prompt_kind: 'none',
                  },
                  {
                    action_id: 'task-approve-1:request_changes',
                    kind: 'request_changes_task',
                    label: 'Request changes',
                    target: {
                      target_kind: 'task',
                      target_id: 'task-approve-1',
                    },
                    requires_confirmation: true,
                    prompt_kind: 'feedback',
                  },
                  {
                    action_id: 'task-approve-1:add-work',
                    kind: 'add_work_item',
                    label: 'Add / Modify Work',
                    target: {
                      target_kind: 'work_item',
                      target_id: 'work-item-1',
                    },
                    requires_confirmation: false,
                    prompt_kind: 'none',
                  },
                ],
              },
              {
                action_id: 'task-escalation-1:open_escalation',
                action_kind: 'resolve_escalation',
                label: 'Escalation requires guidance',
                summary: 'The specialist hit a replay mismatch while trying to submit the handoff.',
                work_item_id: 'work-item-1',
                target: {
                  target_kind: 'task',
                  target_id: 'task-escalation-1',
                },
                priority: 'high',
                requires_confirmation: false,
                submission: {
                  route_kind: 'task_mutation',
                  method: 'POST',
                },
                details: [
                  { label: 'Escalation', value: 'Resolve the handoff replay mismatch and decide how to resume.' },
                  { label: 'Blocking state', value: 'The task cannot submit its handoff until the replay mismatch is resolved.' },
                  { label: 'Work so far', value: 'Context reviewed, summary drafted, and one submit_handoff attempt already failed.' },
                  { label: 'Evidence', value: 'The draft summary file exists and the failure reason was captured in the packet.' },
                ],
                responses: [
                  {
                    action_id: 'task-escalation-1:resolve',
                    kind: 'resolve_escalation',
                    label: 'Resume with guidance',
                    target: {
                      target_kind: 'task',
                      target_id: 'task-escalation-1',
                    },
                    requires_confirmation: true,
                    prompt_kind: 'instructions',
                  },
                ],
              },
            ],
            total_count: 2,
            default_sort: 'priority_desc',
          } as never,
        }),
      ),
    );

    expect(html).toContain('Approval required');
    expect(html).toContain('Escalation requires guidance');
    expect(html).toContain('Work item · Prepare release bundle');
    expect(html).toContain('Needs decision');
    expect(html).toContain('Why it needs action');
    expect(html).toContain('Blocking now');
    expect(html).toContain('Work so far');
    expect(html).toContain('Evidence');
    expect(html).toContain('Recommended action');
    expect(html).toContain('Approve');
    expect(html).toContain('Approve release packet');
    expect(html).toContain('Release packet verification passed and the required artifacts are attached.');
    expect(html).toContain('Resolve the handoff replay mismatch and decide how to resume.');
    expect(html).toContain('Resume with guidance');
    expect(html).toContain('Approve');
    expect(html).toContain('Request changes');
    expect(html).not.toContain('Add / Modify Work');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground');
  });

  it('renders replay-conflict escalation details that explain the winning persisted handoff context', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowNeedsAction, {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          scopeSubject: 'work item',
          scopeLabel: 'Work item: Implement release-audit revision 1',
          packet: {
            items: [
              {
                action_id: 'task-escalation-2:open_escalation',
                action_kind: 'resolve_escalation',
                label: 'Resolve escalation',
                summary:
                  'Task completion is blocked by platform handoff replay conflicts.',
                work_item_id: 'work-item-2',
                target: {
                  target_kind: 'task',
                  target_id: 'task-escalation-2',
                },
                priority: 'high',
                requires_confirmation: false,
                submission: {
                  route_kind: 'task_mutation',
                  method: 'POST',
                },
                details: [
                  {
                    label: 'Escalation',
                    value:
                      'Resolve the replay conflict and decide whether the persisted handoff should settle this task.',
                  },
                  {
                    label: 'Blocking state',
                    value:
                      'The task cannot submit another handoff until the replay conflict is resolved.',
                  },
                  {
                    label: 'Work so far',
                    value:
                      'The implementation packet was drafted and the submit_handoff call conflicted with an earlier persisted handoff.',
                  },
                  {
                    label: 'Conflicting request ids',
                    value:
                      'Submitted req-new; persisted req-old; current attempt req-current',
                  },
                  {
                    label: 'Persisted handoff',
                    value: 'Persisted policy review handoff (req-old, full)',
                  },
                  {
                    label: 'Completion contract',
                    value: 'Already satisfied by the persisted handoff.',
                  },
                ],
                responses: [
                  {
                    action_id: 'task-escalation-2:resolve',
                    kind: 'resolve_escalation',
                    label: 'Resume with guidance',
                    target: {
                      target_kind: 'task',
                      target_id: 'task-escalation-2',
                    },
                    requires_confirmation: true,
                    prompt_kind: 'instructions',
                  },
                ],
              },
            ],
            total_count: 1,
            default_sort: 'priority_desc',
          } as never,
        }),
      ),
    );

    expect(html).toContain('Conflicting request ids');
    expect(html).toContain('Submitted req-new; persisted req-old; current attempt req-current');
    expect(html).toContain('Persisted handoff');
    expect(html).toContain('Persisted policy review handoff (req-old, full)');
    expect(html).toContain('Completion contract');
    expect(html).toContain('Already satisfied by the persisted handoff.');
  });

  it('hides faux actions that are not unresolved approvals or escalations', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowNeedsAction, {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          scopeSubject: 'work item',
          scopeLabel: 'Work item: Prepare release bundle',
          packet: {
            items: [
              {
                action_id: 'work-item-1:blocked',
                action_kind: 'unblock_work_item',
                label: 'Address requested changes',
                summary: 'This item should stay out of Needs Action because it only offers add work.',
                target: {
                  target_kind: 'work_item',
                  target_id: 'work-item-1',
                },
                priority: 'high',
                requires_confirmation: false,
                submission: {
                  route_kind: 'workflow_intervention',
                  method: 'POST',
                },
                responses: [
                  {
                    action_id: 'work-item-1:add-work',
                    kind: 'add_work_item',
                    label: 'Add / Modify Work',
                    target: {
                      target_kind: 'work_item',
                      target_id: 'work-item-1',
                    },
                    requires_confirmation: false,
                    prompt_kind: 'none',
                  },
                ],
              },
              {
                action_id: 'task-1:retry',
                action_kind: 'retry_task',
                label: 'Retry failed task',
                summary: 'This item should stay out because retries are not operator decisions.',
                target: {
                  target_kind: 'task',
                  target_id: 'task-1',
                },
                priority: 'medium',
                requires_confirmation: false,
                submission: {
                  route_kind: 'task_mutation',
                  method: 'POST',
                },
                responses: [
                  {
                    action_id: 'task-1:retry',
                    kind: 'retry_task',
                    label: 'Retry task',
                    target: {
                      target_kind: 'task',
                      target_id: 'task-1',
                    },
                    requires_confirmation: false,
                    prompt_kind: 'none',
                  },
                ],
              },
              {
                action_id: 'workflow-1:redrive',
                action_kind: 'recover_workflow',
                label: 'Workflow recovery',
                summary: 'This item should stay out because redrive is not a pending approval or escalation.',
                target: {
                  target_kind: 'workflow',
                  target_id: 'workflow-1',
                },
                priority: 'high',
                requires_confirmation: true,
                submission: {
                  route_kind: 'workflow_mutation',
                  method: 'POST',
                },
                responses: [
                  {
                    action_id: 'workflow-1:redrive',
                    kind: 'redrive_workflow',
                    label: 'Redrive workflow',
                    target: {
                      target_kind: 'workflow',
                      target_id: 'workflow-1',
                    },
                    requires_confirmation: true,
                    prompt_kind: 'none',
                  },
                ],
              },
            ],
            total_count: 3,
            default_sort: 'priority_desc',
            scope_summary: {
              workflow_total_count: 3,
              selected_scope_total_count: 3,
              scoped_away_workflow_count: 0,
            },
          } as never,
        }),
      ),
    );

    expect(html).toContain('Nothing in this work item requires operator action right now.');
    expect(html).not.toContain('Address requested changes');
    expect(html).not.toContain('Add / Modify Work');
    expect(html).not.toContain('Retry failed task');
    expect(html).not.toContain('Retry task');
    expect(html).not.toContain('Workflow recovery');
    expect(html).not.toContain('Redrive workflow');
  });

  it('normalizes stale task empty-state copy back to the selected work item scope', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowNeedsAction, {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          scopeSubject: 'task',
          packet: {
            items: [],
            total_count: 0,
            default_sort: 'priority_desc',
            scope_summary: {
              workflow_total_count: 0,
              selected_scope_total_count: 0,
              scoped_away_workflow_count: 0,
            },
          } as never,
        }),
      ),
    );

    expect(html).toContain('Nothing in this work item requires operator action right now.');
    expect(html).not.toContain('Nothing in this workflow requires operator action right now.');
    expect(html).not.toContain('Nothing in this task requires operator action right now.');
  });

  it('keeps prompt-based responses inside the needs-action surface instead of opening a dialog', () => {
    const source = readFileSync(new URL('./workflow-needs-action.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('DialogContent');
    expect(source).not.toContain('DialogTitle');
  });

  it('routes escalation responses through the workflow work-item task api helper', () => {
    const source = [
      readFileSync(new URL('./workflow-needs-action.tsx', import.meta.url), 'utf8'),
      readFileSync(new URL('./workflow-needs-action.support.ts', import.meta.url), 'utf8'),
    ].join('\n');

    expect(source).toContain('dashboardApi.resolveWorkflowWorkItemTaskEscalation(');
    expect(source).not.toContain('dashboardApi.resolveEscalation(action.target.target_id');
  });

  it('routes workflow task review actions through workflow-backed helpers instead of raw task endpoints', () => {
    const source = [
      readFileSync(new URL('./workflow-needs-action.tsx', import.meta.url), 'utf8'),
      readFileSync(new URL('./workflow-needs-action.support.ts', import.meta.url), 'utf8'),
    ].join('\n');

    expect(source).toContain('dashboardApi.approveWorkflowWorkItemTask(');
    expect(source).toContain('dashboardApi.approveWorkflowWorkItemTaskOutput(');
    expect(source).toContain('dashboardApi.rejectWorkflowWorkItemTask(');
    expect(source).toContain('dashboardApi.requestWorkflowWorkItemTaskChanges(');
    expect(source).toContain('dashboardApi.retryWorkflowWorkItemTask(');
    expect(source).not.toContain('dashboardApi.approveTask(action.target.target_id');
    expect(source).not.toContain('dashboardApi.approveTaskOutput(action.target.target_id');
    expect(source).not.toContain('dashboardApi.rejectTask(action.target.target_id');
    expect(source).not.toContain('dashboardApi.requestTaskChanges(action.target.target_id');
    expect(source).not.toContain('dashboardApi.retryTask(action.target.target_id');
  });
});
