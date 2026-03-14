import { describe, expect, it } from 'vitest';

import {
  PROJECT_DETAIL_TAB_OPTIONS,
  buildProjectDetailHeaderState,
  buildProjectKnowledgeOverview,
  buildProjectModelOverview,
  buildProjectSettingsOverview,
  buildProjectWorkspaceOverview,
  buildRoleModelOverrides,
  buildStructuredObject,
  hydrateRoleOverrideDrafts,
  normalizeProjectDetailTab,
  objectToStructuredDrafts,
} from './project-detail-support.js';

describe('project detail support', () => {
  it('converts project config objects into structured entry drafts', () => {
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
        'Project config',
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
        'Project config',
      ),
    ).toThrow(/duplicate key 'retries'/i);
  });

  it('hydrates resolved and custom role overrides into structured drafts', () => {
    const drafts = hydrateRoleOverrideDrafts(['architect', 'developer'], {
      architect: { provider: 'openai', model: 'gpt-5' },
      qa: { provider: 'anthropic', model: 'claude-sonnet' },
    });

    expect(drafts.map((draft) => draft.role)).toEqual(['architect', 'developer', 'qa']);
    expect(drafts[0]?.provider).toBe('openai');
    expect(drafts[2]?.model).toBe('claude-sonnet');
  });

  it('builds typed project model override payloads and validates required fields', () => {
    expect(
      buildRoleModelOverrides([
        {
          id: 'a',
          role: 'architect',
          provider: 'openai',
          model: 'gpt-5',
          reasoningConfig: '{"effort":"medium"}',
        },
      ]),
    ).toEqual({
      architect: {
        provider: 'openai',
        model: 'gpt-5',
        reasoning_config: { effort: 'medium' },
      },
    });

    expect(() =>
      buildRoleModelOverrides([
        { id: 'a', role: 'architect', provider: 'openai', model: '', reasoningConfig: '' },
      ]),
    ).toThrow(/must include both provider and model/i);
  });

  it('normalizes unknown project-detail tabs back to the spec workspace', () => {
    expect(PROJECT_DETAIL_TAB_OPTIONS.map((option) => option.value)).toEqual([
      'overview',
      'settings',
      'knowledge',
      'automation',
      'delivery',
    ]);
    expect(
      PROJECT_DETAIL_TAB_OPTIONS.find((option) => option.value === 'automation')?.description,
    ).toContain('control center');
    expect(
      PROJECT_DETAIL_TAB_OPTIONS.find((option) => option.value === 'delivery')?.description,
    ).toContain('what ran');
    expect(normalizeProjectDetailTab('knowledge')).toBe('knowledge');
    expect(normalizeProjectDetailTab('unknown')).toBe('overview');
    expect(normalizeProjectDetailTab(null)).toBe('overview');
  });

  it('builds a project workspace overview from project and spec posture', () => {
    const overview = buildProjectWorkspaceOverview(
      {
        id: 'project-1',
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
      },
      {
        project_id: 'project-1',
        config: { retries: 2, branch: 'main' },
        instructions: { operator: 'Review blockers' },
        resources: { repo: { kind: 'git' } },
        documents: { runbook: { title: 'Release runbook' } },
        tools: { shell: { allowed: true } },
      },
    );

    expect(overview.summary).toContain('lifecycle');
    expect(overview.packets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Lifecycle', value: 'Active' }),
        expect.objectContaining({ label: 'Knowledge base', value: '8 entries' }),
        expect.objectContaining({ label: 'Automation', value: 'Verified repo' }),
        expect.objectContaining({ label: 'Repository', value: 'Linked' }),
        expect.objectContaining({ label: 'Delivery', value: '7 workflows' }),
      ]),
    );
    expect(overview.packets.map((packet) => packet.value)).not.toContain('Ready');
    expect(overview.packets.find((packet) => packet.label === 'Automation')?.detail).toContain(
      'github',
    );
    expect(overview.packets.find((packet) => packet.label === 'Delivery')?.detail).toContain(
      '2 active',
    );
    expect(overview.packets.find((packet) => packet.label === 'Delivery')?.detail).toContain(
      '5 completed',
    );
  });

  it('builds an expanded overview header state with cross-workspace quick actions', () => {
    const headerState = buildProjectDetailHeaderState(
      {
        id: 'project-1',
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
    expect(headerState.quickActions.map((action) => action.label)).toEqual([
      'Settings',
      'Knowledge base',
    ]);
  });

  it('builds a compact non-overview header state that keeps context and utility actions', () => {
    const headerState = buildProjectDetailHeaderState(
      {
        id: 'project-1',
        name: 'Release automation',
        slug: 'release-automation',
        is_active: false,
        repository_url: null,
      },
      'settings',
    );

    expect(headerState.mode).toBe('compact');
    expect(headerState.activeTab.label).toBe('Settings');
    expect(headerState.description).toContain('control plane');
    expect(headerState.contextPills).toEqual([]);
    expect(headerState.quickActions.map((action) => action.label)).toEqual(['Back to overview']);
    expect(headerState.quickActions[0]?.href).toBe('/projects/project-1');
  });

  it('builds a settings overview from project posture and stored settings', () => {
    const overview = buildProjectSettingsOverview({
      id: 'project-1',
      name: 'Release automation',
      slug: 'release-automation',
      is_active: true,
      repository_url: 'https://example.com/repo.git',
      git_webhook_provider: 'github',
      git_webhook_secret_configured: true,
      settings: {
        retention_days: 30,
        credentials: {
          git_token: null,
          git_token_configured: false,
          git_ssh_private_key: null,
          git_ssh_private_key_configured: false,
          git_ssh_known_hosts: null,
          git_ssh_known_hosts_configured: false,
          webhook_secret: null,
          webhook_secret_configured: false,
        },
        model_overrides: {
          architect: { provider: 'openai', model: 'gpt-5' },
          reviewer: { provider: 'anthropic', model: 'claude-sonnet' },
        },
      },
    });

    expect(overview.summary).toContain('control plane');
    expect(overview.packets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Stored settings', value: '3 entries' }),
        expect.objectContaining({ label: 'Model overrides', value: '2 roles' }),
        expect.objectContaining({ label: 'Repository trust', value: 'Configured' }),
        expect.objectContaining({ label: 'Repository link', value: 'Linked' }),
      ]),
    );
  });

  it('builds a knowledge overview that groups spec, resources, tools, memory, and artifacts', () => {
    const overview = buildProjectKnowledgeOverview(
      {
        id: 'project-1',
        name: 'Release automation',
        slug: 'release-automation',
        is_active: true,
        memory: {
          last_release: '2026-03-12',
          rollout: { phase: 'candidate' },
        },
      },
      {
        project_id: 'project-1',
        config: { retries: 2, branch: 'main' },
        instructions: { operator: 'Review blockers' },
        resources: { repo: { kind: 'git' } },
        documents: { runbook: { title: 'Release runbook' } },
        tools: { shell: { allowed: true } },
      },
    );

    expect(overview.summary).toContain('structured spec');
    expect(overview.packets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Structured spec', value: '3 entries' }),
        expect.objectContaining({ label: 'Reference assets', value: '2 items' }),
        expect.objectContaining({ label: 'Tool policy', value: '1 entry' }),
        expect.objectContaining({ label: 'Shared memory', value: '2 entries' }),
        expect.objectContaining({ label: 'Artifacts', value: 'Inline workspace' }),
      ]),
    );
  });

  it('summarizes override posture and fallback risk for project models', () => {
    const overview = buildProjectModelOverview(
      {
        architect: { provider: 'openai', model: 'gpt-5' },
      },
      {
        architect: {
          source: 'project',
          fallback: false,
          resolved: {
            provider: { name: 'openai', providerType: 'chat' },
            model: { modelId: 'gpt-5' },
          },
        },
        qa: {
          source: 'base',
          fallback: true,
          resolved: null,
          fallback_reason: 'Provider unavailable',
        },
      },
    );

    expect(overview.summary).toContain('falling back');
    expect(overview.packets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Project overrides', value: '1 role' }),
        expect.objectContaining({ label: 'Resolved roles', value: '2 roles' }),
        expect.objectContaining({ label: 'Fallbacks', value: '1 active' }),
      ]),
    );
  });
});
