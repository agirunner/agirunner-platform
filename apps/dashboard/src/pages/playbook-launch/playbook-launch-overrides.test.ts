import { describe, expect, it } from 'vitest';

import {
  countConfiguredWorkflowOverrides,
  readWorkflowOverrides,
} from './playbook-launch-overrides.js';

describe('playbook launch overrides', () => {
  it('counts only role override drafts with configured values', () => {
    expect(
      countConfiguredWorkflowOverrides([
        { id: 'a', role: 'architect', provider: 'openai', model: 'gpt-5', reasoningEntries: [] },
        { id: 'b', role: 'developer', provider: '', model: '', reasoningEntries: [] },
        {
          id: 'c',
          role: 'reviewer',
          provider: '',
          model: '',
          reasoningEntries: [{ id: 'r1', key: 'effort', valueType: 'string', value: 'high' }],
        },
      ]),
    ).toBe(2);
  });

  it('returns zero when no drafts have configured values', () => {
    expect(
      countConfiguredWorkflowOverrides([
        { id: 'a', role: 'architect', provider: '', model: '', reasoningEntries: [] },
      ]),
    ).toBe(0);
  });

  it('reads valid workflow override structure from drafts', () => {
    const result = readWorkflowOverrides([
      { id: 'a', role: 'architect', provider: 'openai', model: 'gpt-5', reasoningEntries: [] },
    ]);
    expect(result.error).toBeUndefined();
    expect(result.value).toBeDefined();
    expect(result.value!['architect']).toBeDefined();
  });

  it('captures errors from invalid override drafts', () => {
    const result = readWorkflowOverrides([
      { id: 'a', role: 'architect', provider: 'openai', model: '', reasoningEntries: [] },
    ]);
    expect(result.error).toBeDefined();
    expect(result.value).toBeUndefined();
  });

  it('returns empty overrides when no drafts are configured', () => {
    const result = readWorkflowOverrides([]);
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({});
  });
});
