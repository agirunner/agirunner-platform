import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_DETAIL_TAB_OPTIONS,
  buildWorkspaceDetailHeaderState,
  buildWorkspaceKnowledgeOverview,
  buildWorkspaceSettingsOverview,
  buildWorkspaceOverview,
  buildStructuredObject,
  normalizeWorkspaceDetailTab,
  objectToStructuredDrafts,
} from './workspace-detail-support.js';

describe('workspace detail support', () => {
  it('converts workspace config objects into structured entry drafts', () => {
    const drafts = objectToStructuredDrafts({
      retries: 2,
      dry_run: true,
      notes: 'ship it',
      labels: { lane: 'release' },
    });

    expect(drafts.map((draft) => [draft.key, draft.valueType])).toEqual([
      ['retries', 'number'],
      ['dry_run', 'boolean'],
      ['notes', 'string'],
      ['labels', 'json'],
    ]);
  });

  it('builds structured objects and rejects duplicate keys', () => {
    expect(
      buildStructuredObject(
        [
          { id: 'a', key: 'retries', valueType: 'number', value: '3' },
          { id: 'b', key: 'dry_run', valueType: 'boolean', value: 'false' },
        ],
        'Workspace config',
      ),
    ).toEqual({
      retries: 3,
      dry_run: false,
    });

    expect(() =>
      buildStructuredObject(
        [
          { id: 'a', key: 'retries', valueType: 'number', value: '3' },
          { id: 'b', key: 'retries', valueType: 'string', value: 'again' },
        ],
        'Workspace config',
      ),
    ).toThrow(/duplicate key 'retries'/i);
  });

  it('normalizes unknown workspace-detail tabs back to the spec workspace', () => {
    expect(WORKSPACE_DETAIL_TAB_OPTIONS.map((option) => option.value)).toEqual([
      'overview',
      'settings',
      'knowledge',
    ]);
    expect(normalizeWorkspaceDetailTab('knowledge')).toBe('knowledge');
    expect(normalizeWorkspaceDetailTab('unknown')).toBe('overview');
    expect(normalizeWorkspaceDetailTab(null)).toBe('overview');
  });

  it('builds a workspace workspace overview from workspace and spec posture', () => {
    const overview = buildWorkspaceOverview({
      id: 'workspace-1',
      name: 'Release automation',
      slug: 'release-automation',
      is_active: true,
      repository_url: 'https://example.com/repo.git',
      git_webhook_provider: 'github',
      summary: {
        active_workflow_count: 2,
        completed_workflow_count: 5,
        attention_workflow_count: 0,
        total_workflow_count: 7,
        last_workflow_activity_at: '2026-03-13T08:00:00Z',
      },
      memory: {
        last_release: '2026-03-12',
        rollout: { phase: 'candidate' },
      },
      updated_at: '2026-03-13T08:00:00Z',
    });

    expect(overview.summary).toContain('lifecycle');
    expect(overview.packets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Lifecycle', value: 'Active' }),
        expect.objectContaining({ label: 'Shared memory', value: '2 entries' }),
        expect.objectContaining({ label: 'Storage', value: 'Git Remote' }),
      ]),
    );
    expect(overview.packets.map((packet) => packet.value)).not.toContain('Ready');
    expect(overview.packets.map((packet) => packet.label)).not.toContain('Automation');
    expect(overview.packets.map((packet) => packet.label)).not.toContain('Delivery');
  });

  it('builds an expanded overview header state without redundant quick actions', () => {
    const headerState = buildWorkspaceDetailHeaderState(
      {
        id: 'workspace-1',
        name: 'Release automation',
        slug: 'release-automation',
        is_active: true,
        repository_url: 'https://example.com/repo.git',
      },
      'overview',
    );

    expect(headerState.mode).toBe('expanded');
    expect(headerState.activeTab.label).toBe('Overview');
    expect(headerState.description).not.toContain('Overview surfaces posture');
    expect(headerState.contextPills).toEqual([]);
    expect(headerState.quickActions).toEqual([]);
  });

  it('builds a compact non-overview header state without redundant back links', () => {
    const headerState = buildWorkspaceDetailHeaderState(
      {
        id: 'workspace-1',
        name: 'Release automation',
        slug: 'release-automation',
        is_active: false,
        repository_url: null,
      },
      'settings',
    );

    expect(headerState.mode).toBe('compact');
    expect(headerState.activeTab.label).toBe('Settings');
    expect(headerState.description).toBe('Adjust workspace basics and storage configuration.');
    expect(headerState.contextPills).toEqual([]);
    expect(headerState.quickActions).toEqual([]);
  });

  it('builds a settings overview from workspace posture and storage defaults', () => {
    const overview = buildWorkspaceSettingsOverview({
      id: 'workspace-1',
      name: 'Release automation',
      slug: 'release-automation',
      is_active: true,
      repository_url: 'https://example.com/repo.git',
      settings: {
        retention_days: 30,
        credentials: {
          git_token: null,
          git_token_configured: false,
        },
        workspace_brief: 'Keep release automation ready for Friday handoff.',
      },
    });

    expect(overview.summary).toContain('control plane');
    expect(overview.packets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Stored settings', value: '3 entries' }),
        expect.objectContaining({ label: 'Workspace storage', value: 'Git Remote' }),
      ]),
    );
    expect(overview.packets.map((packet) => packet.label)).not.toContain('Workspace Context');
  });

  it('builds a knowledge overview around workspace artifacts and shared memory', () => {
    const overview = buildWorkspaceKnowledgeOverview(
      {
        id: 'workspace-1',
        name: 'Release automation',
        slug: 'release-automation',
        is_active: true,
        memory: {
          last_release: '2026-03-12',
          rollout: { phase: 'candidate' },
        },
      },
    );

    expect(overview.summary).toContain('workspace-owned artifacts');
    expect(overview.packets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Workspace artifacts', value: 'Inline workspace' }),
        expect.objectContaining({ label: 'Shared memory', value: '2 entries' }),
      ]),
    );
    expect(overview.packets.map((packet) => packet.label)).not.toContain('Workspace Context');
    expect(overview.packets.map((packet) => packet.label)).not.toContain('Knowledge entries');
  });

});
