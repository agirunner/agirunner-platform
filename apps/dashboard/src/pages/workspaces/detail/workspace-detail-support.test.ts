import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_DETAIL_TAB_OPTIONS,
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

  it('normalizes missing, unknown, and legacy workspace-detail tabs back to settings', () => {
    expect(WORKSPACE_DETAIL_TAB_OPTIONS.map((option) => option.value)).toEqual([
      'settings',
      'knowledge',
    ]);
    expect(normalizeWorkspaceDetailTab('knowledge')).toBe('knowledge');
    expect(normalizeWorkspaceDetailTab('overview')).toBe('settings');
    expect(normalizeWorkspaceDetailTab('unknown')).toBe('settings');
    expect(normalizeWorkspaceDetailTab(null)).toBe('settings');
  });
});
