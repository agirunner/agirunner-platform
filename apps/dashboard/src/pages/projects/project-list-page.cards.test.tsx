import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import {
  ProjectListEmptyState,
  ProjectListFilteredEmptyState,
  ProjectListGrid,
} from './project-list-page.cards.js';

vi.mock('./project-list-page.dialogs.js', () => ({
  CreateProjectDialog: (props: { buttonLabel?: string }) =>
    createElement('button', undefined, props.buttonLabel ?? 'Create project'),
  DeleteProjectDialog: () => createElement('div', undefined, 'Delete project dialog'),
  EditProjectDialog: () => createElement('div', undefined, 'Edit project dialog'),
}));

describe('project list page cards', () => {
  it('renders project cards with grouped workspace actions and quieter management controls', () => {
    const markup = renderCards([
      {
        id: 'project-1',
        name: 'Alpha',
        slug: 'alpha-slug',
        description: 'Primary delivery workspace',
        is_active: true,
        repository_url: null,
        summary: {
          active_workflow_count: 2,
          completed_workflow_count: 5,
          attention_workflow_count: 0,
          total_workflow_count: 7,
          last_workflow_activity_at: '2026-03-14T09:30:00.000Z',
        },
      },
    ]);

    expect(markup).toContain('Alpha');
    expect(markup).toContain('Primary delivery workspace');
    expect(markup).toContain('Active');
    expect(markup).toContain('href="/projects/project-1"');
    expect(markup).toContain('href="/projects/project-1?tab=settings"');
    expect(markup).toContain('href="/projects/project-1?tab=knowledge"');
    expect(markup).toContain('href="/projects/project-1?tab=automation"');
    expect(markup).toContain('href="/projects/project-1?tab=delivery"');
    expect(markup).toContain('2 active workflows · 5 completed');
    expect(markup).toContain('Open workspace');
    expect(markup).toContain('Settings');
    expect(markup).toContain('Knowledge');
    expect(markup).toContain('Automation');
    expect(markup).toContain('Delivery');
    expect(markup).toContain('Edit basics');
    expect(markup).toContain('Delete');
    expect(markup).not.toContain('alpha-slug');
    expect(markup).not.toContain('Ready');
    expect(markup).not.toContain('Summary');
    expect(markup).not.toContain('Next');
    expect(markup).not.toContain('Repo');
    expect(markup).not.toContain('Brief');
    expect(markup).not.toContain('State');
    expect(markup).not.toContain('Created');
    expect(markup).not.toContain('Repository posture');
  });

  it('renders calmer attention styling while keeping inactive cards neutral', () => {
    const markup = renderCards([
      {
        id: 'project-2',
        name: 'Beta',
        slug: 'beta',
        description: '',
        is_active: true,
        repository_url: 'https://github.com/example/beta',
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 0,
          attention_workflow_count: 1,
          total_workflow_count: 3,
          last_workflow_activity_at: '2026-03-14T07:00:00.000Z',
        },
      },
      {
        id: 'project-3',
        name: 'Gamma',
        slug: 'gamma',
        description: 'Dormant workspace',
        is_active: false,
        repository_url: null,
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 3,
          attention_workflow_count: 0,
          total_workflow_count: 3,
          last_workflow_activity_at: '2026-03-13T18:00:00.000Z',
        },
      },
    ]);

    expect(markup).toContain('Needs attention');
    expect(markup).toContain('bg-amber-50/70');
    expect(markup).toContain('Active');
    expect(markup).toContain('Inactive');
    expect(markup).toContain('Add a short description so this project is scannable from the list.');
    expect(markup).toContain('3 workflows total');
    expect(markup).toContain('3 completed');
    expect(markup).not.toContain('bg-yellow-100');
    expect(markup).not.toContain('Ready');
    expect(markup).not.toContain('Needs repository and brief');
    expect(markup).not.toContain('Ready for triage');
  });

  it('keeps the empty states focused on creation and the inactive filter', () => {
    const emptyMarkup = renderToStaticMarkup(createElement(ProjectListEmptyState));
    expect(emptyMarkup).toContain('No projects yet');
    expect(emptyMarkup).toContain('Create first project');

    const filteredMarkup = renderToStaticMarkup(
      createElement(ProjectListFilteredEmptyState, {
        onShowInactive: () => undefined,
      }),
    );
    expect(filteredMarkup).toContain('No active projects to show');
    expect(filteredMarkup).toContain('Show inactive');
  });
});

function renderCards(
  projects: Parameters<typeof ProjectListGrid>[0]['projects'],
): string {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(ProjectListGrid, { projects }),
      ),
    );
  } finally {
    consoleError.mockRestore();
  }
}
