import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';

import type { PlaybookFamilyRecord } from './playbook-list-page.support.js';
import { PlaybookLibraryTable } from './playbook-list-page.table.js';

describe('PlaybookLibraryTable', () => {
  it('labels launch parameter counts as inputs instead of goals', () => {
    const html = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/' },
        createElement(PlaybookLibraryTable, {
          families: [createFamily()],
        }),
      ),
    );

    expect(html).toContain('2 roles · 3 inputs');
    expect(html).not.toContain('2 roles · 3 goals');
  });
});

function createFamily(): PlaybookFamilyRecord {
  return {
    slug: 'community-intake-review',
    name: 'Community Intake Review',
    description: 'Review inbound requests.',
    outcome: 'Produce the routed intake packet.',
    lifecycle: 'planned',
    revisions: [
      {
        id: 'playbook-1',
        name: 'Community Intake Review',
        slug: 'community-intake-review',
        description: 'Review inbound requests.',
        outcome: 'Produce the routed intake packet.',
        lifecycle: 'planned',
        version: 1,
        is_active: true,
        definition: {},
        created_at: '2026-03-31T00:00:00Z',
        updated_at: '2026-03-31T00:00:00Z',
      },
    ],
    revisionCount: 1,
    activeRevisionCount: 1,
    primaryRevision: {
      id: 'playbook-1',
      name: 'Community Intake Review',
      slug: 'community-intake-review',
      description: 'Review inbound requests.',
      outcome: 'Produce the routed intake packet.',
      lifecycle: 'planned',
      version: 1,
      is_active: true,
      definition: {},
      created_at: '2026-03-31T00:00:00Z',
      updated_at: '2026-03-31T00:00:00Z',
    },
    structure: {
      stages: 4,
      boardColumns: 3,
    },
    process: {
      processInstructions: 'Clarify the request and route the work.',
      roleCount: 2,
      stageCount: 4,
      inputCount: 3,
    },
    updatedAt: '2026-03-31T00:00:00Z',
    searchText: 'community intake review',
  };
}
