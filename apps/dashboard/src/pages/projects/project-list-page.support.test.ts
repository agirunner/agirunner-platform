import { describe, expect, it } from 'vitest';

import {
  buildProjectAttentionLabel,
  buildProjectDescription,
  buildProjectMetrics,
  buildProjectReadiness,
  buildProjectSortDirectionLabel,
  filterProjects,
  normalizeProjects,
  sortProjects,
} from './project-list-page.support.js';

describe('project list page support', () => {
  it('keeps the primary project status aligned to lifecycle state', () => {
    expect(
      buildProjectReadiness({
        id: 'p1',
        name: 'Alpha',
        slug: 'alpha',
        description: 'Primary delivery workspace',
        is_active: true,
        repository_url: null,
      }),
    ).toEqual({
      label: 'Active',
      variant: 'success',
    });

    expect(
      buildProjectReadiness({
        id: 'p2',
        name: 'Gamma',
        slug: 'gamma',
        description: 'Dormant workspace',
        is_active: false,
        repository_url: null,
      }),
    ).toEqual({
      label: 'Inactive',
      variant: 'secondary',
    });
  });

  it('builds a separate attention label only when the project needs intervention', () => {
    expect(
      buildProjectAttentionLabel({
        id: 'p1',
        name: 'Alpha',
        slug: 'alpha',
        description: '',
        is_active: true,
        summary: {
          active_workflow_count: 2,
          completed_workflow_count: 5,
          attention_workflow_count: 0,
          total_workflow_count: 7,
          last_workflow_activity_at: '2026-03-14T09:30:00.000Z',
        },
      }),
    ).toBeNull();

    expect(
      buildProjectAttentionLabel({
        id: 'p2',
        name: 'Beta',
        slug: 'beta',
        description: '',
        is_active: true,
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 0,
          attention_workflow_count: 1,
          total_workflow_count: 1,
          last_workflow_activity_at: '2026-03-14T07:00:00.000Z',
        },
      }),
    ).toBe('Needs attention');

    expect(
      buildProjectAttentionLabel({
        id: 'p3',
        name: 'Gamma',
        slug: 'gamma',
        description: '',
        is_active: false,
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 1,
          attention_workflow_count: 2,
          total_workflow_count: 3,
          last_workflow_activity_at: '2026-03-14T06:00:00.000Z',
        },
      }),
    ).toBeNull();
  });

  it('hides inactive projects until the explicit filter is enabled', () => {
    const projects = [
      {
        id: 'p1',
        name: 'Alpha',
        slug: 'alpha',
        description: 'Primary delivery workspace',
        is_active: true,
      },
      {
        id: 'p2',
        name: 'Gamma',
        slug: 'gamma',
        description: 'Dormant workspace',
        is_active: false,
      },
    ];

    expect(filterProjects(projects, false).map((project) => project.name)).toEqual(['Alpha']);
    expect(filterProjects(projects, true).map((project) => project.name)).toEqual([
      'Alpha',
      'Gamma',
    ]);
  });

  it('builds readable workflow metrics from project summaries', () => {
    expect(
      buildProjectMetrics({
        id: 'p1',
        name: 'Alpha',
        slug: 'alpha',
        description: 'Primary delivery workspace',
        is_active: true,
        summary: {
          active_workflow_count: 2,
          completed_workflow_count: 5,
          attention_workflow_count: 0,
          total_workflow_count: 7,
          last_workflow_activity_at: '2026-03-14T09:30:00.000Z',
        },
      }),
    ).toBe('2 active workflows · 5 completed');

    expect(
      buildProjectMetrics({
        id: 'p2',
        name: 'Beta',
        slug: 'beta',
        description: '',
        is_active: true,
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 0,
          attention_workflow_count: 1,
          total_workflow_count: 3,
          last_workflow_activity_at: '2026-03-14T07:00:00.000Z',
        },
      }),
    ).toBe('3 workflows total');

    expect(
      buildProjectMetrics({
        id: 'p3',
        name: 'Gamma',
        slug: 'gamma',
        description: '',
        is_active: true,
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 0,
          attention_workflow_count: 0,
          total_workflow_count: 0,
          last_workflow_activity_at: null,
        },
      }),
    ).toBe('No workflows yet');
  });

  it('normalizes and trims card descriptions for compact display', () => {
    expect(
      buildProjectDescription({
        id: 'p1',
        name: 'Alpha',
        slug: 'alpha',
        description:
          '  This workspace owns release orchestration, handoff quality checks, operator runbooks, and a much longer narrative than the list should render in full.  ',
        is_active: true,
      }),
    ).toBe(
      'This workspace owns release orchestration, handoff quality checks, operator runbooks, and a much longer narrative t…',
    );

    expect(
      buildProjectDescription({
        id: 'p2',
        name: 'Beta',
        slug: 'beta',
        description: '   ',
        is_active: true,
      }),
    ).toBe('Add a short description so this project is scannable from the list.');
  });

  it('sorts projects by recent activity, name, and workflow volume', () => {
    const projects = [
      {
        id: 'p1',
        name: 'Gamma',
        slug: 'gamma',
        description: 'Active',
        is_active: true,
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 0,
          attention_workflow_count: 0,
          total_workflow_count: 1,
          last_workflow_activity_at: '2026-03-14T08:00:00.000Z',
        },
      },
      {
        id: 'p2',
        name: 'Alpha',
        slug: 'alpha',
        description: 'Active',
        is_active: true,
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 0,
          attention_workflow_count: 0,
          total_workflow_count: 9,
          last_workflow_activity_at: '2026-03-14T12:00:00.000Z',
        },
      },
      {
        id: 'p3',
        name: 'Beta',
        slug: 'beta',
        description: 'Active',
        is_active: true,
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 0,
          attention_workflow_count: 0,
          total_workflow_count: 4,
          last_workflow_activity_at: null,
        },
      },
    ];

    expect(
      sortProjects(projects, { key: 'recent_activity', direction: 'desc' }).map(
        (project) => project.name,
      ),
    ).toEqual([
      'Alpha',
      'Gamma',
      'Beta',
    ]);
    expect(
      sortProjects(projects, { key: 'project_name', direction: 'asc' }).map(
        (project) => project.name,
      ),
    ).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(
      sortProjects(projects, { key: 'workflow_volume', direction: 'desc' }).map(
        (project) => project.name,
      ),
    ).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('builds contextual sort direction labels', () => {
    expect(buildProjectSortDirectionLabel('recent_activity', 'desc')).toBe('Newest first');
    expect(buildProjectSortDirectionLabel('project_name', 'asc')).toBe('A → Z');
    expect(buildProjectSortDirectionLabel('workflow_volume', 'asc')).toBe('Fewest workflows');
  });

  it('normalizes list responses from either supported payload shape', () => {
    expect(
      normalizeProjects({
        data: [{ id: 'p1', name: 'Alpha', slug: 'alpha' }],
      } as never),
    ).toHaveLength(1);
    expect(normalizeProjects([{ id: 'p2', name: 'Beta', slug: 'beta' }] as never)).toHaveLength(
      1,
    );
  });
});
