import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ContentBrowserSurface } from './content-browser-page.js';

describe('content browser page rendering', () => {
  it('renders malformed project and document payloads without crashing the page', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
        },
      },
    });

    client.setQueryData(['projects'], {
      data: [{ id: 'project-1', name: {} as never, slug: 'alpha' }],
    });
    client.setQueryData(['project-timeline', 'project-1'], [
      {
        workflow_id: 'workflow-1',
        name: {} as never,
        state: {} as never,
        created_at: '2026-03-12T09:00:00.000Z',
      },
    ]);
    client.setQueryData(['content-documents', 'workflow-1'], [
      {
        logical_name: 'brief',
        scope: 'workflow',
        source: 'artifact',
        title: {} as never,
        description: {} as never,
        metadata: [] as never,
        created_at: '2026-03-12T09:00:00.000Z',
        artifact: {
          id: 'artifact-1',
          task_id: 'task-1',
          logical_path: 'docs/brief.md',
          content_type: {} as never,
          download_url: '/download/brief',
        },
      },
    ]);
    client.setQueryData(['workflow-tasks', 'workflow-1'], {
      data: [
        {
          id: 'task-1',
          title: {} as never,
          state: 'claimed',
          stage_name: {} as never,
          role: {} as never,
          work_item_id: 'wi-1',
          activation_id: 'act-1',
          is_orchestrator_task: false,
        },
      ],
    });
    client.setQueryData(['workflow-work-items', 'workflow-1'], [
      {
        id: 'wi-1',
        workflow_id: 'workflow-1',
        stage_name: {} as never,
        title: {} as never,
        column_id: {} as never,
        priority: {} as never,
      },
    ]);

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ContentBrowserSurface scopedProjectId="project-1" scopedWorkflowId="workflow-1" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    consoleError.mockRestore();

    expect(markup).toContain('Content Browser');
    expect(markup).toContain('workflow-1');
    expect(markup).toContain('brief');
    expect(markup).not.toContain('[object Object]');
  });
});
