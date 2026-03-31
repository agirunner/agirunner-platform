import { describe, expect, it } from 'vitest';

import {
  filterCommunityCatalogPlaybooks,
  formatCommunityCatalogImportError,
  listCommunityCatalogCategories,
  resolveCommunityCatalogConflictAction,
} from './playbook-community-import.support.js';

const PLAYBOOKS = [
  {
    id: 'bug-fix',
    name: 'Bug Fix',
    author: 'agirunner',
    category: 'engineering',
    stability: 'experimental' as const,
    version: '1.0.0',
    summary: 'Diagnose and fix a bounded defect.',
    specialist_ids: ['developer'],
    path: 'playbooks/engineering/bug-fix/playbook.yaml',
  },
  {
    id: 'customer-support-triage',
    name: 'Customer Support Triage',
    author: 'agirunner',
    category: 'operations',
    stability: 'stable' as const,
    version: '1.0.0',
    summary: 'Classify, prioritize, and route inbound support issues.',
    specialist_ids: ['support-triage-analyst'],
    path: 'playbooks/operations/customer-support-triage/playbook.yaml',
  },
];

describe('playbook community import support', () => {
  it('filters community playbooks by search, category, and stability', () => {
    expect(filterCommunityCatalogPlaybooks(PLAYBOOKS, 'bug', 'all', 'all')).toEqual([
      expect.objectContaining({ id: 'bug-fix' }),
    ]);
    expect(filterCommunityCatalogPlaybooks(PLAYBOOKS, 'agirunner', 'all', 'all')).toHaveLength(2);
    expect(filterCommunityCatalogPlaybooks(PLAYBOOKS, '', 'operations', 'stable')).toEqual([
      expect.objectContaining({ id: 'customer-support-triage' }),
    ]);
    expect(filterCommunityCatalogPlaybooks(PLAYBOOKS, '', 'engineering', 'stable')).toEqual([]);
  });

  it('lists unique community catalog categories in sorted order', () => {
    expect(listCommunityCatalogCategories(PLAYBOOKS)).toEqual(['engineering', 'operations']);
  });

  it('resolves conflict actions from valid overrides before falling back to defaults', () => {
    const conflict = {
      key: 'specialist:developer',
      artifactType: 'specialist' as const,
      catalogId: 'developer',
      catalogName: 'Software Developer',
      availableActions: ['override_existing'] as const,
      localMatch: {
        id: 'role-1',
        name: 'Software Developer',
        matchKind: 'name' as const,
      },
    };

    expect(
      resolveCommunityCatalogConflictAction(conflict, 'create_new', {
        'specialist:developer': 'override_existing',
      }),
    ).toBe('override_existing');
    expect(resolveCommunityCatalogConflictAction(conflict, 'create_new', {})).toBe(
      'override_existing',
    );
  });

  it('normalizes import errors for inline dialog feedback', () => {
    expect(formatCommunityCatalogImportError(new Error('HTTP 409: Role already exists'))).toBe(
      'Role already exists',
    );
    expect(formatCommunityCatalogImportError('')).toBe(
      'Failed to import community playbooks.',
    );
  });
});
