import { describe, expect, it } from 'vitest';

import {
  buildProjectModelOverview,
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
    expect(normalizeProjectDetailTab('automation')).toBe('automation');
    expect(normalizeProjectDetailTab('unknown')).toBe('spec');
    expect(normalizeProjectDetailTab(null)).toBe('spec');
  });

  it('builds a project workspace overview from project and spec posture', () => {
    const overview = buildProjectWorkspaceOverview(
      {
        id: 'project-1',
        name: 'Release automation',
        slug: 'release-automation',
        is_active: true,
        git_webhook_provider: 'github',
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

    expect(overview.summary).toContain('Keep project spec');
    expect(overview.packets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Project status', value: 'Active' }),
        expect.objectContaining({ label: 'Structured spec', value: '3 entries' }),
        expect.objectContaining({ label: 'Linked assets', value: '3 items' }),
        expect.objectContaining({ label: 'Shared memory', value: '2 entries' }),
        expect.objectContaining({ label: 'Repo signature', value: 'Configured' }),
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
