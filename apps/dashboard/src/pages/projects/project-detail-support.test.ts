import { describe, expect, it } from 'vitest';

import {
  buildRoleModelOverrides,
  buildStructuredObject,
  hydrateRoleOverrideDrafts,
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
    const drafts = hydrateRoleOverrideDrafts(
      ['architect', 'developer'],
      {
        architect: { provider: 'openai', model: 'gpt-5' },
        qa: { provider: 'anthropic', model: 'claude-sonnet' },
      },
    );

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
});
