import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import {
  summarizeWorkItemExecution,
  type DashboardWorkItemTaskRecord,
} from './workflow-work-item-detail-support.js';
import { WorkItemTasksSection } from './workflow-work-item-tasks-section.js';

describe('workflow work-item tasks section', () => {
  it('renders the attention queue and step actions without object leakage', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['workflow-work-item-agents', 'workflow-1'], []);
    const tasks = createTasks();
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          null,
          createElement(WorkItemTasksSection, {
            workflowId: 'workflow-1',
            workItemId: 'work-item-1',
            tasks,
            executionSummary: summarizeWorkItemExecution(tasks),
            isMilestone: false,
            childCount: 0,
            onWorkItemChanged: async () => undefined,
          }),
        ),
      ),
    );

    expect(markup).toContain('Requires operator attention');
    expect(markup).toContain('Approve release candidate');
    expect(markup).toContain('Execution queue');
    expect(markup).toContain('Approve Step');
    expect(markup).toContain('Request Changes');
    expect(markup).toContain('Open work-item flow');
    expect(markup).not.toContain('[object Object]');
  });
});

function createTasks(): DashboardWorkItemTaskRecord[] {
  return [
    {
      id: 'task-approve',
      title: 'Approve release candidate',
      state: 'awaiting_approval',
      role: 'reviewer',
      stage_name: 'qa',
      work_item_id: 'work-item-1',
      depends_on: ['task-build'],
    },
    {
      id: 'task-build',
      title: 'Build release candidate',
      state: 'completed',
      role: 'builder',
      stage_name: 'qa',
      work_item_id: 'work-item-1',
      depends_on: [],
      completed_at: '2026-03-31T00:00:00.000Z',
    },
  ] as DashboardWorkItemTaskRecord[];
}
