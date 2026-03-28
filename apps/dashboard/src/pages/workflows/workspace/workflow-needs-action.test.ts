import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowNeedsAction } from './workflow-needs-action.js';

describe('WorkflowNeedsAction', () => {
  it('renders direct inline response controls instead of punting normal actions to steering', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowNeedsAction, {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          packet: {
            items: [
              {
                action_id: 'task-approve-1:awaiting_approval',
                action_kind: 'review_work_item',
                label: 'Approval required',
                summary: 'Approve release packet is waiting for operator approval.',
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
                ],
              },
            ],
            total_count: 1,
            default_sort: 'priority_desc',
          },
        }),
      ),
    );

    expect(html).toContain('Approval required');
    expect(html).toContain('Approve');
    expect(html).toContain('Request changes');
    expect(html).not.toContain('Open Steering');
  });

  it('keeps workflow-level controls out of the needs-action response surface', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowNeedsAction, {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          packet: {
            items: [
              {
                action_id: 'workflow-1:terminal',
                action_kind: 'recover_workflow',
                label: 'Workflow recovery',
                summary: 'This workflow could be redriven, but workflow-level controls stay in the header.',
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
                    action_id: 'workflow-1:add-work',
                    kind: 'add_work_item',
                    label: 'Add / Modify Work',
                    target: {
                      target_kind: 'workflow',
                      target_id: 'workflow-1',
                    },
                    requires_confirmation: false,
                    prompt_kind: 'none',
                  },
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
            total_count: 1,
            default_sort: 'priority_desc',
          },
        }),
      ),
    );

    expect(html).toContain('Workflow recovery');
    expect(html).not.toContain('Add / Modify Work');
    expect(html).not.toContain('Redrive workflow');
  });

  it('renders add-or-modify-work responses inline for blocked work items', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowNeedsAction, {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          packet: {
            items: [
              {
                action_id: 'work-item-1:blocked',
                action_kind: 'unblock_work_item',
                label: 'Address requested changes',
                summary: 'Revise release packet is blocked: Add rollback notes before resubmitting.',
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
            ],
            total_count: 1,
            default_sort: 'priority_desc',
          },
        }),
      ),
    );

    expect(html).toContain('Address requested changes');
    expect(html).toContain('Add / Modify Work');
    expect(html).not.toContain('Open Steering');
  });

  it('renders stage-gate decision responses inline instead of dropping them from needs action', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowNeedsAction, {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          packet: {
            items: [
              {
                action_id: 'work-item-1:awaiting_approval',
                action_kind: 'review_work_item',
                label: 'Approval required',
                summary: 'Approve Curiosity Deck brief is waiting for operator approval.',
                target: {
                  target_kind: 'work_item',
                  target_id: 'work-item-1',
                },
                priority: 'high',
                requires_confirmation: true,
                submission: {
                  route_kind: 'workflow_mutation',
                  method: 'POST',
                },
                responses: [
                  {
                    action_id: 'gate-1:approve_gate',
                    kind: 'approve_gate',
                    label: 'Approve',
                    target: {
                      target_kind: 'gate',
                      target_id: 'gate-1',
                    },
                    requires_confirmation: false,
                    prompt_kind: 'none',
                  },
                  {
                    action_id: 'gate-1:request_changes_gate',
                    kind: 'request_changes_gate',
                    label: 'Request changes',
                    target: {
                      target_kind: 'gate',
                      target_id: 'gate-1',
                    },
                    requires_confirmation: true,
                    prompt_kind: 'feedback',
                  },
                ],
              },
            ],
            total_count: 1,
            default_sort: 'priority_desc',
          },
        }),
      ),
    );

    expect(html).toContain('Approval required');
    expect(html).toContain('Approve');
    expect(html).toContain('Request changes');
  });

  it('renders the empty state for the exact current scope instead of defaulting to workflow copy', () => {
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
          },
        }),
      ),
    );

    expect(html).toContain('Nothing in this task requires operator action right now.');
    expect(html).not.toContain('Nothing in this workflow requires operator action right now.');
  });

  it('renders approval context details inline for approval cards', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowNeedsAction, {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          packet: {
            items: [
              {
                action_id: 'task-approve-1:awaiting_approval',
                action_kind: 'review_work_item',
                label: 'Approval required',
                summary: 'Review release packet is waiting for operator approval on Approve release packet.',
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
                  { label: 'Context', value: 'Release packet draft and rollback notes are assembled for sign-off.' },
                  {
                    label: 'Verification',
                    value: 'Release packet verification passed and the required artifacts are attached.',
                  },
                  { label: 'Revision', value: '3' },
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
                ],
              },
            ],
            total_count: 1,
            default_sort: 'priority_desc',
          } as never,
        }),
      ),
    );

    expect(html).toContain('Approve release packet');
    expect(html).toContain('Release packet draft and rollback notes are assembled for sign-off.');
    expect(html).toContain('Release packet verification passed and the required artifacts are attached.');
    expect(html).toContain('Revision');
    expect(html).toContain('3');
  });

  it('shows the exact selected scope in the needs-action header while keeping action context inline', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowNeedsAction, {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          scopeSubject: 'task',
          scopeLabel: 'Task: Verify deliverable',
          packet: {
            items: [
              {
                action_id: 'task-approve-1:awaiting_approval',
                action_kind: 'review_work_item',
                label: 'Approval required',
                summary: 'Review release packet is waiting for operator approval on Approve release packet.',
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
                ],
              },
            ],
            total_count: 1,
            default_sort: 'priority_desc',
          } as never,
        }),
      ),
    );

    expect(html).toContain('Task: Verify deliverable');
    expect(html).toContain('Approval required');
    expect(html).toContain('Approve release packet');
    expect(html).not.toContain('Open Steering');
  });

  it('renders escalation reason, context, and work-so-far details inside the needs-action card', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowNeedsAction, {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          packet: {
            items: [
              {
                action_id: 'work-item-1:open_escalation',
                action_kind: 'resolve_escalation',
                label: 'Resolve escalation',
                summary:
                  'workflows-intake-02 needs escalation resolution: submit_handoff replay mismatch conflict.',
                target: {
                  target_kind: 'task',
                  target_id: '771908c8-0634-467a-b41d-6dd4a6798d7d',
                },
                priority: 'high',
                requires_confirmation: false,
                submission: {
                  route_kind: 'task_mutation',
                  method: 'POST',
                },
                details: [
                  {
                    label: 'Context',
                    value: 'item content is ready for policy review, summary file already written',
                  },
                  {
                    label: 'Work so far',
                    value: 'reviewed context, wrote summary, submit_handoff rejected once',
                  },
                ],
                responses: [
                  {
                    action_id: 'task-1:resolve',
                    kind: 'resolve_escalation',
                    label: 'Resume with guidance',
                    target: {
                      target_kind: 'task',
                      target_id: '771908c8-0634-467a-b41d-6dd4a6798d7d',
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

    expect(html).toContain('submit_handoff replay mismatch conflict');
    expect(html).toContain('Context');
    expect(html).toContain('item content is ready for policy review, summary file already written');
    expect(html).toContain('Work so far');
    expect(html).toContain('reviewed context, wrote summary, submit_handoff rejected once');
  });

  it('keeps prompt-based responses inside the needs-action surface instead of opening a dialog', () => {
    const source = readFileSync(new URL('./workflow-needs-action.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('DialogContent');
    expect(source).not.toContain('DialogTitle');
  });
});
