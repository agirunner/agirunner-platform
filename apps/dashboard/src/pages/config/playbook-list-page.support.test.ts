import { describe, expect, it } from 'vitest';

import {
  filterPlaybooks,
  summarizePlaybookLibrary,
  summarizePlaybookStructure,
} from './playbook-list-page.support.js';

const PLAYBOOKS = [
  {
    id: 'playbook-1',
    name: 'SDLC Continuous',
    slug: 'sdlc-continuous',
    description: 'Continuous delivery board',
    outcome: 'Ship changes continuously',
    lifecycle: 'continuous' as const,
    version: 4,
    is_active: true,
    definition: { board: { columns: [{}, {}] }, stages: [{}, {}] },
  },
  {
    id: 'playbook-2',
    name: 'Release Checklist',
    slug: 'release-checklist',
    description: 'Milestone release flow',
    outcome: 'Deliver a stable release',
    lifecycle: 'standard' as const,
    version: 2,
    is_active: false,
    definition: { board: { columns: [{}] }, stages: [{}] },
  },
];

describe('playbook list support', () => {
  it('filters playbooks by search, status, and lifecycle', () => {
    expect(filterPlaybooks(PLAYBOOKS, 'release', 'all', 'all')).toEqual([PLAYBOOKS[1]]);
    expect(filterPlaybooks(PLAYBOOKS, '', 'active', 'continuous')).toEqual([PLAYBOOKS[0]]);
    expect(filterPlaybooks(PLAYBOOKS, '', 'archived', 'standard')).toEqual([PLAYBOOKS[1]]);
  });

  it('summarizes library posture for the operator surface', () => {
    expect(summarizePlaybookLibrary(PLAYBOOKS)).toEqual([
      {
        label: 'Active revisions',
        value: '1 active',
        detail: '1 launchable playbook revision currently available.',
      },
      {
        label: 'Archived revisions',
        value: '1 archived',
        detail: 'Archived playbooks stay available for review and restore, but cannot launch until reactivated.',
      },
      {
        label: 'Lifecycle mix',
        value: '1 continuous / 1 standard',
        detail: 'Use lifecycle mix to confirm whether the library is skewed toward repeatable or milestone-based work.',
      },
    ]);
  });

  it('reads the board structure summary from the stored definition', () => {
    expect(summarizePlaybookStructure(PLAYBOOKS[0])).toEqual({
      boardColumns: 2,
      stages: 2,
    });
  });
});
