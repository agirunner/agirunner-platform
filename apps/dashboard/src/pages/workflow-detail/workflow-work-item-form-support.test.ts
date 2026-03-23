import { describe, expect, it } from 'vitest';

import {
  areWorkItemMetadataDraftsEqual,
  createWorkItemMetadataDraftState,
  normalizeWorkItemPriority,
  validateWorkItemMetadataEntries,
} from './workflow-work-item-form-support.js';

describe('workflow work item form support', () => {
  it('hydrates existing metadata into locked editable rows', () => {
    const state = createWorkItemMetadataDraftState({
      owner: 'architect',
      retries: 2,
    });

    expect(state.drafts).toHaveLength(2);
    expect(state.lockedDraftIds).toEqual(state.drafts.map((draft) => draft.id));
    expect(state.drafts.map((draft) => draft.key)).toEqual(['owner', 'retries']);
  });

  it('validates duplicate keys and typed json values', () => {
    const validation = validateWorkItemMetadataEntries([
      { id: 'entry-1', key: 'packet', valueType: 'json', value: '{' },
      { id: 'entry-2', key: 'packet', valueType: 'string', value: 'duplicate' },
    ]);

    expect(validation.isValid).toBe(false);
    expect(validation.blockingIssues).toContain(
      'Keys must be unique within work-item metadata.',
    );
    expect(validation.blockingIssues).toContain('Enter valid JSON before saving.');
  });

  it('compares metadata drafts by structured value and normalizes priority fallbacks', () => {
    const state = createWorkItemMetadataDraftState({
      enabled: true,
      packet: { order: 1, owner: 'ops' },
    });

    expect(
      areWorkItemMetadataDraftsEqual(state.drafts, {
        packet: { owner: 'ops', order: 1 },
        enabled: true,
      }),
    ).toBe(true);
    expect(normalizeWorkItemPriority('high')).toBe('high');
    expect(normalizeWorkItemPriority('unexpected')).toBe('normal');
  });
});
