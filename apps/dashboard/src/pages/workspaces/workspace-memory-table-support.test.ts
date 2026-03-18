import { describe, expect, it } from 'vitest';

import {
  createMemoryEditorDraft,
  inferMemoryEditorKind,
  isStructuredMemoryValue,
  parseMemoryEditorDraft,
  summarizeMemoryValue,
} from './workspace-memory-table-support.js';

describe('workspace memory table support', () => {
  it('creates typed editor drafts from existing memory values', () => {
    expect(createMemoryEditorDraft('release-ready')).toEqual({
      kind: 'string',
      textValue: 'release-ready',
      booleanValue: 'false',
    });
    expect(createMemoryEditorDraft(42)).toEqual({
      kind: 'number',
      textValue: '42',
      booleanValue: 'false',
    });
    expect(createMemoryEditorDraft(true)).toEqual({
      kind: 'boolean',
      textValue: '',
      booleanValue: 'true',
    });
  });

  it('parses typed editor drafts with inline validation', () => {
    expect(parseMemoryEditorDraft({ kind: 'number', textValue: '7.5', booleanValue: 'false' })).toEqual({
      value: 7.5,
      error: null,
    });
    expect(parseMemoryEditorDraft({ kind: 'boolean', textValue: '', booleanValue: 'true' })).toEqual({
      value: true,
      error: null,
    });
    expect(parseMemoryEditorDraft({ kind: 'json', textValue: '{bad}', booleanValue: 'false' })).toEqual({
      value: null,
      error: 'JSON values must be valid before saving.',
    });
  });

  it('summarizes structured memory values for operator previews', () => {
    expect(inferMemoryEditorKind({ rollout: 'staged' })).toBe('json');
    expect(isStructuredMemoryValue(['qa', 'prod'])).toBe(true);
    expect(summarizeMemoryValue({ rollout: 'staged', owner: 'ops' })).toBe(
      '2 fields: rollout, owner',
    );
    expect(summarizeMemoryValue(['qa', 'prod'])).toBe('2 items');
  });
});
