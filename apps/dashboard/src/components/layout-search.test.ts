import { describe, expect, it } from 'vitest';

import {
  buildCommandPaletteSearchItems,
  COMMAND_PALETTE_MIN_QUERY_LENGTH,
  describeCommandPaletteState,
  filterCommandPaletteQuickLinks,
  moveCommandPaletteSelection,
  shouldRunCommandPaletteSearch,
  type CommandPaletteItem,
} from './layout-search.js';

const QUICK_LINKS: CommandPaletteItem[] = [
  {
    id: 'nav:/mission-control',
    href: '/mission-control',
    label: 'Live Board',
    meta: 'Mission Control',
    kind: 'navigation',
  },
  {
    id: 'nav:/work/workflows',
    href: '/work/workflows',
    label: 'Workflows',
    meta: 'Work',
    kind: 'navigation',
  },
  {
    id: 'nav:/config/playbooks',
    href: '/config/playbooks',
    label: 'Playbooks',
    meta: 'Configuration',
    kind: 'navigation',
  },
];

describe('command palette helpers', () => {
  it('requires a trimmed minimum query length before running workspace search', () => {
    expect(shouldRunCommandPaletteSearch('')).toBe(false);
    expect(shouldRunCommandPaletteSearch(' a ')).toBe(false);
    expect(shouldRunCommandPaletteSearch('ab')).toBe(true);
    expect(COMMAND_PALETTE_MIN_QUERY_LENGTH).toBe(2);
  });

  it('filters quick links by label and section metadata', () => {
    expect(filterCommandPaletteQuickLinks(QUICK_LINKS, '')).toEqual(QUICK_LINKS);
    expect(filterCommandPaletteQuickLinks(QUICK_LINKS, 'config')).toEqual([
      QUICK_LINKS[2],
    ]);
    expect(filterCommandPaletteQuickLinks(QUICK_LINKS, 'work')).toEqual([
      QUICK_LINKS[1],
    ]);
  });

  it('maps dashboard search results into palette items', () => {
    const items = buildCommandPaletteSearchItems([
      {
        id: 'workflow-1',
        type: 'workflow',
        label: 'Auth Workflow',
        subtitle: 'running',
        href: '/work/workflows/workflow-1',
      },
    ]);

    expect(items).toEqual([
      {
        id: 'workflow:workflow-1',
        href: '/work/workflows/workflow-1',
        label: 'Auth Workflow',
        meta: 'running',
        kind: 'workflow',
      },
    ]);
  });

  it('moves selection predictably for keyboard navigation', () => {
    expect(moveCommandPaletteSelection(-1, 0, 'next')).toBe(-1);
    expect(moveCommandPaletteSelection(-1, 3, 'next')).toBe(0);
    expect(moveCommandPaletteSelection(-1, 3, 'previous')).toBe(2);
    expect(moveCommandPaletteSelection(0, 3, 'next')).toBe(1);
    expect(moveCommandPaletteSelection(2, 3, 'next')).toBe(0);
    expect(moveCommandPaletteSelection(0, 3, 'previous')).toBe(2);
    expect(moveCommandPaletteSelection(1, 3, 'first')).toBe(0);
    expect(moveCommandPaletteSelection(1, 3, 'last')).toBe(2);
  });

  it('describes live, empty, loading, and error palette states', () => {
    expect(
      describeCommandPaletteState({
        query: 'au',
        status: 'loading',
        visibleItemCount: 0,
      }),
    ).toEqual({
      title: 'Searching the workspace',
      detail: 'Results update as you type. Keep typing to narrow the matches.',
    });

    expect(
      describeCommandPaletteState({
        query: 'au',
        status: 'ready',
        visibleItemCount: 0,
      }),
    ).toEqual({
      title: 'No matches yet',
      detail: 'Try a different name, ID fragment, or status keyword.',
    });

    expect(
      describeCommandPaletteState({
        query: 'au',
        status: 'ready',
        visibleItemCount: 2,
      }),
    ).toEqual({
      title: 'Live results',
      detail: 'Use arrow keys to move, Enter to open, and Escape to dismiss.',
    });

    expect(
      describeCommandPaletteState({
        query: '',
        status: 'idle',
        visibleItemCount: 3,
      }),
    ).toEqual({
      title: 'Quick links',
      detail: 'Jump to common destinations immediately, or keep typing to search everything.',
    });

    expect(
      describeCommandPaletteState({
        query: 'auth',
        status: 'error',
        visibleItemCount: 0,
        errorMessage: 'Search backend unavailable',
      }),
    ).toEqual({
      title: 'Search unavailable',
      detail: 'Search backend unavailable',
    });
  });
});
