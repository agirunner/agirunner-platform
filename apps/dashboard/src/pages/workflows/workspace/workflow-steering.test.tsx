import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowSteering } from './workflow-steering.js';

describe('WorkflowSteering', () => {
  it('renders task-scoped steering copy from the current workbench scope', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowSteering, {
          workflowId: 'workflow-1',
          workflowName: 'Workflow 1',
          selectedWorkItemId: 'work-item-7',
          scope: {
            scopeKind: 'selected_task',
            title: 'Task',
            subject: 'task',
            name: 'Verify deliverable',
            banner: 'Task: Verify deliverable',
          },
          interventions: [],
          messages: [],
          sessionId: null,
          canAcceptRequest: true,
        }),
      ),
    );

    expect(html).toContain('Task: Verify deliverable');
    expect(html).toContain('Record durable requests, responses, and attachments for this task.');
    expect(html).toContain('Guide Verify deliverable toward the next legal action.');
    expect(html).toContain('No steering history exists for this task yet.');
  });
});
