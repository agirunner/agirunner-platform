import { describe, expect, it } from 'vitest';

import {
  buildPlaybookFamilies,
  filterPlaybookFamilies,
  summarizePlaybookStructure,
  summarizePlaybookFamilyCounts,
  validatePlaybookCreateDraft,
} from './playbook-list-page.support.js';

const PLAYBOOKS = [
  {
    id: 'playbook-1',
    name: 'SDLC Continuous',
    slug: 'sdlc-continuous',
    description: 'Continuous delivery board',
    outcome: 'Ship changes continuously',
    lifecycle: 'ongoing' as const,
    version: 4,
    is_active: true,
    updated_at: '2026-03-15T12:00:00Z',
    definition: { board: { columns: [{}, {}] }, stages: [{}, {}] },
  },
  {
    id: 'playbook-1-v3',
    name: 'SDLC Continuous',
    slug: 'sdlc-continuous',
    description: 'Older active revision',
    outcome: 'Ship changes continuously',
    lifecycle: 'ongoing' as const,
    version: 3,
    is_active: false,
    updated_at: '2026-03-12T12:00:00Z',
    definition: { board: { columns: [{}, {}] }, stages: [{}, {}] },
  },
  {
    id: 'playbook-2',
    name: 'Release Checklist',
    slug: 'release-checklist',
    description: 'Milestone release flow',
    outcome: 'Deliver a stable release',
    lifecycle: 'planned' as const,
    version: 2,
    is_active: false,
    updated_at: '2026-03-14T12:00:00Z',
    definition: { board: { columns: [{}] }, stages: [{}] },
  },
  {
    id: 'playbook-2-v1',
    name: 'Release Checklist',
    slug: 'release-checklist',
    description: 'Older archived revision',
    outcome: 'Deliver a stable release',
    lifecycle: 'planned' as const,
    version: 1,
    is_active: false,
    updated_at: '2026-03-10T12:00:00Z',
    definition: { board: { columns: [{}] }, stages: [{}] },
  },
];

describe('playbook list support', () => {
  it('groups revisions into family-first library records', () => {
    expect(buildPlaybookFamilies(PLAYBOOKS)).toEqual([
      expect.objectContaining({
        slug: 'sdlc-continuous',
        revisionCount: 2,
        activeRevisionCount: 1,
        primaryRevision: expect.objectContaining({ id: 'playbook-1' }),
      }),
      expect.objectContaining({
        slug: 'release-checklist',
        revisionCount: 2,
        activeRevisionCount: 0,
        primaryRevision: expect.objectContaining({ id: 'playbook-2' }),
      }),
    ]);
  });

  it('filters and sorts family-first library records', () => {
    const families = buildPlaybookFamilies(PLAYBOOKS);
    expect(filterPlaybookFamilies(families, 'release', 'all', 'all', 'updated-desc')).toEqual([
      expect.objectContaining({ slug: 'release-checklist' }),
    ]);
    expect(filterPlaybookFamilies(families, '', 'active', 'ongoing', 'updated-desc')).toEqual([
      expect.objectContaining({ slug: 'sdlc-continuous' }),
    ]);
    expect(filterPlaybookFamilies(families, '', 'archived', 'planned', 'updated-desc')).toEqual([
      expect.objectContaining({ slug: 'release-checklist' }),
    ]);
    expect(filterPlaybookFamilies(families, '', 'all', 'all', 'name-asc').map((family) => family.slug)).toEqual([
      'release-checklist',
      'sdlc-continuous',
    ]);
  });

  it('summarizes family posture for the compact library toolbar', () => {
    expect(summarizePlaybookFamilyCounts(buildPlaybookFamilies(PLAYBOOKS))).toEqual({
      familyCount: 2,
      activeFamilyCount: 1,
      archivedFamilyCount: 1,
    });
  });

  it('reads the board structure summary from the stored definition', () => {
    expect(summarizePlaybookStructure(PLAYBOOKS[0])).toEqual({
      boardColumns: 2,
      stages: 2,
    });
  });

  it('validates playbook creation basics with inline recovery guidance', () => {
    expect(
      validatePlaybookCreateDraft({
        name: '',
        slug: '',
        outcome: '',
        playbooks: PLAYBOOKS,
      }),
    ).toMatchObject({
      normalizedSlug: '',
      slugSource: 'name',
      fieldErrors: {
        name: 'Enter a playbook name.',
        outcome: 'Describe the workflow outcome this playbook owns.',
      },
      blockingIssues: [
        'Enter a playbook name.',
        'Describe the workflow outcome this playbook owns.',
      ],
      isValid: false,
    });

    expect(
      validatePlaybookCreateDraft({
        name: 'Release Checklist',
        slug: '',
        outcome: 'Deliver a stable release',
        playbooks: PLAYBOOKS,
      }),
    ).toMatchObject({
      normalizedSlug: 'release-checklist',
      fieldErrors: {
        slug: "Slug 'release-checklist' already exists. Choose a different name or custom slug.",
      },
      isValid: false,
    });

    expect(
      validatePlaybookCreateDraft({
        name: '!!!',
        slug: '',
        outcome: 'Ship safely',
        playbooks: PLAYBOOKS,
      }),
    ).toMatchObject({
      normalizedSlug: '',
      fieldErrors: {
        name: 'Use letters or numbers so the generated slug is valid.',
      },
      isValid: false,
    });
  });
});
