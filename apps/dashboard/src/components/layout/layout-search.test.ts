import { describe, expect, it } from 'vitest';

import {
  buildCommandPaletteSearchItems,
  buildCommandPaletteSections,
  clearRecentCommandPaletteItems,
  COMMAND_PALETTE_MIN_QUERY_LENGTH,
  describeCommandPaletteState,
  filterCommandPaletteQuickLinks,
  recordRecentCommandPaletteItem,
  moveCommandPaletteSelection,
  readRecentCommandPaletteItems,
  shouldRunCommandPaletteSearch,
  type CommandPaletteItem,
} from './layout-search.js';

const QUICK_LINKS: CommandPaletteItem[] = [
  {
    id: 'nav:/workflows',
    href: '/workflows',
    label: 'Workflows',
    meta: 'Workflows',
    kind: 'navigation',
  },
  {
    id: 'nav:/work/tasks',
    href: '/work/tasks',
    label: 'Tasks',
    meta: 'Workflows',
    kind: 'navigation',
  },
  {
    id: 'nav:/design/playbooks',
    href: '/design/playbooks',
    label: 'Playbooks',
    meta: 'Work Design',
    kind: 'navigation',
  },
];

function createStorageStub(seed: string | null = null) {
  let value = seed;
  return {
    getItem() {
      return value;
    },
    setItem(_key: string, next: string) {
      value = next;
    },
    removeItem() {
      value = null;
    },
  };
}

describe('command palette helpers', () => {
  it('requires a trimmed minimum query length before running workspace search', () => {
    expect(shouldRunCommandPaletteSearch('')).toBe(false);
    expect(shouldRunCommandPaletteSearch(' a ')).toBe(false);
    expect(shouldRunCommandPaletteSearch('ab')).toBe(true);
    expect(COMMAND_PALETTE_MIN_QUERY_LENGTH).toBe(2);
  });

  it('filters quick links by label and section metadata', () => {
    expect(filterCommandPaletteQuickLinks(QUICK_LINKS, '')).toEqual(QUICK_LINKS);
    expect(filterCommandPaletteQuickLinks(QUICK_LINKS, 'design')).toEqual([
      QUICK_LINKS[2],
    ]);
    expect(filterCommandPaletteQuickLinks(QUICK_LINKS, 'workflow')).toEqual([
      QUICK_LINKS[0],
      QUICK_LINKS[1],
    ]);
  });

  it('surfaces nav items via keyword match when the label does not contain the query', () => {
    const links: CommandPaletteItem[] = [
      {
        id: 'nav:/platform/orchestrator',
        href: '/platform/orchestrator',
        label: 'Orchestrator',
        meta: 'Platform',
        kind: 'navigation',
        keywords: ['orchestrator', 'prompt', 'model routing', 'pool posture'],
      },
      {
        id: 'nav:/design/specialists',
        href: '/design/specialists',
        label: 'Specialists',
        meta: 'Work Design',
        kind: 'navigation',
        keywords: ['specialist', 'agent roles', 'role definitions'],
      },
    ];

    const promptResults = filterCommandPaletteQuickLinks(links, 'prompt');
    expect(promptResults).toHaveLength(1);
    expect(promptResults[0].id).toBe('nav:/platform/orchestrator');

    const orchestratorResults = filterCommandPaletteQuickLinks(links, 'orchestrator');
    expect(orchestratorResults).toHaveLength(1);
    expect(orchestratorResults[0].id).toBe('nav:/platform/orchestrator');

    const poolResults = filterCommandPaletteQuickLinks(links, 'pool');
    expect(poolResults).toHaveLength(1);
    expect(poolResults[0].id).toBe('nav:/platform/orchestrator');

    const roleDefResults = filterCommandPaletteQuickLinks(links, 'role definitions');
    expect(roleDefResults).toHaveLength(1);
    expect(roleDefResults[0].id).toBe('nav:/design/specialists');
  });

  it('maps dashboard search results into palette items', () => {
    const items = buildCommandPaletteSearchItems([
      {
        id: 'workflow-1',
        type: 'workflow',
        label: 'Auth Workflow',
        subtitle: 'running',
        href: '/workflows?rail=workflow&workflow=workflow-1',
      },
    ]);

    expect(items).toEqual([
      {
        id: 'workflow:workflow-1',
        href: '/workflows?rail=workflow&workflow=workflow-1',
        label: 'Auth Workflow',
        meta: 'running',
        kind: 'workflow',
      },
    ]);
  });

  it('builds grouped command sections with actions, recents, quick links, and ranked search results', () => {
    const sections = buildCommandPaletteSections({
      query: 'auth',
      actionItems: [
        {
          id: 'action:refresh-view',
          label: 'Refresh current view',
          meta: 'Workspace',
          kind: 'action',
          actionId: 'refresh-view',
          keywords: ['refresh'],
        },
      ],
      recentItems: [
        {
          id: 'workflow:recent-auth',
          href: '/workflows?rail=workflow&workflow=recent-auth',
          label: 'Recent Auth Workflow',
          meta: 'Workflows',
          kind: 'workflow',
        },
      ],
      quickLinks: QUICK_LINKS,
      searchResults: [
        {
          id: 'workflow-1',
          type: 'workflow',
          label: 'Auth Workflow',
          subtitle: 'review stage',
          href: '/workflows?rail=workflow&workflow=workflow-1',
        },
        {
          id: 'task-1',
          type: 'task',
          label: 'Auth Review Task',
          subtitle: 'in progress',
          href: '/work/tasks/task-1',
        },
      ],
    });

    expect(sections.map((section) => section.title)).toEqual([
      'Recent',
      'Workflows',
      'Tasks',
    ]);
  });

  it('stores and clears recent palette items while skipping destructive actions', () => {
    const storage = createStorageStub();
    const recentWorkflow: CommandPaletteItem = {
      id: 'workflow:recent-auth',
      href: '/workflows?rail=workflow&workflow=recent-auth',
      label: 'Recent Auth Workflow',
      meta: 'Workflows',
      kind: 'workflow',
    };

    expect(recordRecentCommandPaletteItem(recentWorkflow, storage)).toEqual([recentWorkflow]);
    expect(readRecentCommandPaletteItems(storage)).toEqual([recentWorkflow]);
    expect(
      recordRecentCommandPaletteItem(
        {
          id: 'action:logout',
          label: 'Log out',
          meta: 'Session',
          kind: 'action',
          actionId: 'logout',
        },
        storage,
      ),
    ).toEqual([recentWorkflow]);
    expect(clearRecentCommandPaletteItems(storage)).toEqual([]);
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
      title: 'Searching and ranking results',
      detail: 'Actions, recent items, and quick links stay available while live results load.',
    });

    expect(
      describeCommandPaletteState({
        query: 'au',
        status: 'ready',
        visibleItemCount: 0,
      }),
    ).toEqual({
      title: 'No matches yet',
      detail: 'Try a different name, ID fragment, status keyword, or action verb.',
    });

    expect(
      describeCommandPaletteState({
        query: 'au',
        status: 'ready',
        visibleItemCount: 2,
      }),
    ).toEqual({
      title: 'Commands and results',
      detail: 'Use arrow keys to move, Enter to open or run, and Escape to dismiss.',
    });

    expect(
      describeCommandPaletteState({
        query: '',
        status: 'idle',
        visibleItemCount: 3,
      }),
    ).toEqual({
      title: 'Actions, recent items, and quick links',
      detail: 'Use arrow keys to move, Enter to open or run, and Escape to dismiss.',
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
