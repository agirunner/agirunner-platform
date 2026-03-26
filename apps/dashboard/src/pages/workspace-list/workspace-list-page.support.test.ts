import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceMetrics,
  buildWorkspaceReadiness,
  buildWorkspaceSortDirectionLabel,
  buildWorkspaceStorageSummary,
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

  it('filters workspaces by status and search text', () => {
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
        settings: {
          workspace_storage_type: 'host_directory' as const,
        },
      },
      {
        id: 'p3',
        name: 'Delta Knowledge',
        slug: 'delta',
        description: 'Research and knowledge archive',
        is_active: true,
      },
    ];

    expect(filterWorkspaces(workspaces, '', 'active').map((workspace) => workspace.name)).toEqual([
      'Alpha',
      'Delta Knowledge',
    ]);
    expect(filterWorkspaces(workspaces, '', 'inactive').map((workspace) => workspace.name)).toEqual([
      'Gamma',
    ]);
    expect(filterWorkspaces(workspaces, '', 'all').map((workspace) => workspace.name)).toEqual([
      'Alpha',
      'Gamma',
      'Delta Knowledge',
    ]);
    expect(filterWorkspaces(workspaces, 'knowledge', 'all').map((workspace) => workspace.name)).toEqual([
      'Delta Knowledge',
    ]);
    expect(filterWorkspaces(workspaces, 'host directory', 'inactive').map((workspace) => workspace.name)).toEqual([
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
    ).toBe('2 active workflows · 5 workflows completed');

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

  it('builds workspace storage summaries from the configured storage backing', () => {
    expect(
      buildWorkspaceStorageSummary({
        id: 'p1',
        name: 'Alpha',
        slug: 'alpha',
        is_active: true,
        repository_url: 'https://example.com/repo.git',
        settings: {
          workspace_storage_type: 'git_remote' as const,
          workspace_storage: {
            repository_url: 'https://example.com/repo.git',
          },
        },
      }),
    ).toBe('Git Remote · https://example.com/repo.git');

    expect(
      buildWorkspaceStorageSummary({
        id: 'p2',
        name: 'Beta',
        slug: 'beta',
        is_active: true,
        repository_url: null,
        settings: {
          workspace_storage_type: 'host_directory' as const,
          workspace_storage: {
            host_path: '/srv/workspaces/beta',
          },
        },
      }),
    ).toBe('Host Directory · /srv/workspaces/beta');

    expect(
      buildWorkspaceStorageSummary({
        id: 'p3',
        name: 'Gamma',
        slug: 'gamma',
        is_active: true,
        repository_url: null,
        settings: {
          workspace_storage_type: 'workspace_artifacts' as const,
        },
      }),
    ).toBe('Workspace Artifacts · Uploaded artifacts');
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
