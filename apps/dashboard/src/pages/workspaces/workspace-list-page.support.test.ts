import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceDescription,
  buildWorkspaceMetrics,
  buildWorkspaceReadiness,
  buildWorkspaceSortDirectionLabel,
  filterWorkspaces,
  normalizeWorkspaces,
  sortWorkspaces,
} from './workspace-list-page.support.js';

describe('workspace list page support', () => {
  it('keeps the primary workspace status aligned to lifecycle state', () => {
    expect(
      buildWorkspaceReadiness({
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
      buildWorkspaceReadiness({
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

  it('hides inactive workspaces until the explicit filter is enabled', () => {
    const workspaces = [
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

    expect(filterWorkspaces(workspaces, false).map((workspace) => workspace.name)).toEqual(['Alpha']);
    expect(filterWorkspaces(workspaces, true).map((workspace) => workspace.name)).toEqual([
      'Alpha',
      'Gamma',
    ]);
  });

  it('builds readable workflow metrics from workspace summaries', () => {
    expect(
      buildWorkspaceMetrics({
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
      buildWorkspaceMetrics(
        {
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
        },
        'workflow_volume',
      ),
    ).toBe('3 workflows total');

    expect(
      buildWorkspaceMetrics({
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
      buildWorkspaceDescription({
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
      buildWorkspaceDescription({
        id: 'p2',
        name: 'Beta',
        slug: 'beta',
        description: '   ',
        is_active: true,
      }),
    ).toBe('Add a short description so this workspace is scannable from the list.');
  });

  it('sorts workspaces by recent activity, name, and workflow volume', () => {
    const workspaces = [
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
      sortWorkspaces(workspaces, { key: 'recent_activity', direction: 'desc' }).map(
        (workspace) => workspace.name,
      ),
    ).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(
      sortWorkspaces(workspaces, { key: 'recent_activity', direction: 'asc' }).map(
        (workspace) => workspace.name,
      ),
    ).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(
      sortWorkspaces(workspaces, { key: 'workspace_name', direction: 'asc' }).map(
        (workspace) => workspace.name,
      ),
    ).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(
      sortWorkspaces(workspaces, { key: 'workflow_volume', direction: 'desc' }).map(
        (workspace) => workspace.name,
      ),
    ).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(
      sortWorkspaces(workspaces, { key: 'workflow_volume', direction: 'asc' }).map(
        (workspace) => workspace.name,
      ),
    ).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('uses the selected direction when recent activity falls back to names', () => {
    const workspaces = [
      {
        id: 'p1',
        name: 'Gamma',
        slug: 'gamma',
        description: '',
        is_active: true,
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 0,
          attention_workflow_count: 0,
          total_workflow_count: 1,
          last_workflow_activity_at: null,
        },
      },
      {
        id: 'p2',
        name: 'Alpha',
        slug: 'alpha',
        description: '',
        is_active: true,
        summary: {
          active_workflow_count: 0,
          completed_workflow_count: 0,
          attention_workflow_count: 0,
          total_workflow_count: 1,
          last_workflow_activity_at: null,
        },
      },
    ];

    expect(
      sortWorkspaces(workspaces, { key: 'recent_activity', direction: 'asc' }).map(
        (workspace) => workspace.name,
      ),
    ).toEqual(['Alpha', 'Gamma']);
    expect(
      sortWorkspaces(workspaces, { key: 'recent_activity', direction: 'desc' }).map(
        (workspace) => workspace.name,
      ),
    ).toEqual(['Gamma', 'Alpha']);
  });

  it('builds contextual sort direction labels', () => {
    expect(buildWorkspaceSortDirectionLabel('recent_activity', 'desc')).toBe('Newest first');
    expect(buildWorkspaceSortDirectionLabel('workspace_name', 'asc')).toBe('A → Z');
    expect(buildWorkspaceSortDirectionLabel('workflow_volume', 'asc')).toBe('Fewest workflows');
  });

  it('normalizes list responses from either supported payload shape', () => {
    expect(
      normalizeWorkspaces({
        data: [{ id: 'p1', name: 'Alpha', slug: 'alpha' }],
      } as never),
    ).toHaveLength(1);
    expect(normalizeWorkspaces([{ id: 'p2', name: 'Beta', slug: 'beta' }] as never)).toHaveLength(
      1,
    );
  });
});
