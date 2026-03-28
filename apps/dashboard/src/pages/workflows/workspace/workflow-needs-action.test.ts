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
          onOpenAddWork: vi.fn(),
          onOpenRedrive: vi.fn(),
        }),
      ),
    );

    expect(html).toContain('Approval required');
    expect(html).toContain('Approve');
    expect(html).toContain('Request changes');
    expect(html).not.toContain('Open Steering');
  });
});
