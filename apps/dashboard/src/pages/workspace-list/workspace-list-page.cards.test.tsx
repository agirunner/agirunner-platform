import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import {
  WorkspaceListEmptyState,
  WorkspaceListFilteredEmptyState,
  WorkspaceListGrid,
} from './workspace-list-page.cards.js';

vi.mock('./workspace-list-page.dialogs.js', () => ({
  CreateWorkspaceDialog: (props: { buttonLabel?: string }) =>
    createElement('button', undefined, props.buttonLabel ?? 'Create workspace'),
  DeleteWorkspaceDialog: () => createElement('div', undefined, 'Delete workspace dialog'),
}));

describe('workspace list page cards', () => {
  it('renders workspace cards with a single manage action and aligned card chrome', () => {
    const markup = renderCards(
      [
        {
          id: 'workspace-1',
          name: 'Alpha',
          slug: 'alpha-slug',
          description: 'Primary delivery workspace',
          is_active: true,
          repository_url: null,
          settings: {
            workspace_storage_type: 'workspace_artifacts',
          },
          summary: {
            active_workflow_count: 2,
            completed_workflow_count: 5,
            attention_workflow_count: 0,
            total_workflow_count: 7,
            last_workflow_activity_at: '2026-03-14T09:30:00.000Z',
          },
        },
      ],
      'workflow_volume',
    );

    expect(markup).toContain('Alpha');
    expect(markup).toContain('Active');
    expect(markup).toContain('href="/design/workspaces/workspace-1"');
    expect(markup).toContain('Storage');
    expect(markup).toContain('Workspace Artifacts');
    expect(markup).toContain('Workflows');
    expect(markup).toContain('7 workflows total');
    expect(markup).toContain('Manage');
    expect(markup).toContain('bg-card/80');
    expect(markup).not.toContain('Edit basics');
    expect(markup).not.toContain('Delete');
    expect(markup).not.toContain('Needs attention');
    expect(markup).not.toContain('Open workspace');
    expect(markup).not.toContain('Settings');
    expect(markup).not.toContain('Knowledge');
    expect(markup).not.toContain('Automation');
    expect(markup).not.toContain('Delivery');
    expect(markup).not.toContain('alpha-slug');
    expect(markup).not.toContain('Ready');
    expect(markup).not.toContain('Summary');
    expect(markup).not.toContain('Next');
    expect(markup).not.toContain('Repo');
    expect(markup).not.toContain('Brief');
    expect(markup).not.toContain('State');
    expect(markup).not.toContain('Created');
    expect(markup).not.toContain('Repository posture');
    expect(markup).not.toContain('Primary delivery workspace');
  });

  it('keeps inactive cards neutral without separate attention badges', () => {
    const markup = renderCards([
      {
        id: 'workspace-2',
        name: 'Beta',
        slug: 'beta',
        description: '',
        is_active: true,
        repository_url: 'https://github.com/example/beta',
        settings: {
          workspace_storage_type: 'git_remote',
        },
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 0,
          attention_workflow_count: 1,
          total_workflow_count: 3,
          last_workflow_activity_at: '2026-03-14T07:00:00.000Z',
        },
      },
      {
        id: 'workspace-3',
        name: 'Gamma',
        slug: 'gamma',
        description: 'Dormant workspace',
        is_active: false,
        repository_url: null,
        settings: {
          workspace_storage_type: 'host_directory',
        },
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 3,
          attention_workflow_count: 0,
          total_workflow_count: 3,
          last_workflow_activity_at: '2026-03-13T18:00:00.000Z',
        },
      },
    ]);

    expect(markup).toContain('Active');
    expect(markup).toContain('Inactive');
    expect(markup).toContain('Git Remote');
    expect(markup).toContain('Host Directory');
    expect(markup).toContain('3 workflows total');
    expect(markup).toContain('3 workflows completed');
    expect(markup).not.toContain('Needs attention');
    expect(markup).not.toContain('bg-yellow-100');
    expect(markup).not.toContain('Ready');
    expect(markup).not.toContain('Needs repository and brief');
    expect(markup).not.toContain('Ready for triage');
  });

  it('keeps the empty states focused on creation and the inactive filter', () => {
    const emptyMarkup = renderToStaticMarkup(createElement(WorkspaceListEmptyState));
    expect(emptyMarkup).toContain('No workspaces yet');
    expect(emptyMarkup).toContain('Create first workspace');
    expect(emptyMarkup).toContain('manage storage, memory, artifacts, and delivery');

    const filteredMarkup = renderToStaticMarkup(
      createElement(WorkspaceListFilteredEmptyState, {
        onResetFilters: () => undefined,
      }),
    );
    expect(filteredMarkup).toContain('No workspaces match the current filters');
    expect(filteredMarkup).toContain('Reset filters');
  });
});

function renderCards(
  workspaces: Parameters<typeof WorkspaceListGrid>[0]['workspaces'],
  sortKey: Parameters<typeof WorkspaceListGrid>[0]['sortKey'] = 'recent_activity',
): string {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(WorkspaceListGrid, { workspaces, sortKey }),
      ),
    );
  } finally {
    consoleError.mockRestore();
  }
}
