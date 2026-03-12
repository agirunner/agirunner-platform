import type { DashboardSearchResult } from '../lib/api.js';

export const COMMAND_PALETTE_MIN_QUERY_LENGTH = 2;
export const COMMAND_PALETTE_DEBOUNCE_MS = 180;
export const COMMAND_PALETTE_DEFAULT_LINK_LIMIT = 8;
export const COMMAND_PALETTE_ACTION_LIMIT = 4;
export const COMMAND_PALETTE_RECENT_LIMIT = 6;
export const COMMAND_PALETTE_RESULT_LIMIT_PER_GROUP = 5;

const COMMAND_PALETTE_RECENTS_KEY = 'agirunner.commandPalette.recent';
const LABEL_EXACT_MATCH_SCORE = 700;
const LABEL_PREFIX_MATCH_SCORE = 520;
const LABEL_WORD_MATCH_SCORE = 360;
const LABEL_SUBSTRING_MATCH_SCORE = 240;
const META_EXACT_MATCH_SCORE = 180;
const META_PREFIX_MATCH_SCORE = 140;
const META_WORD_MATCH_SCORE = 100;
const META_SUBSTRING_MATCH_SCORE = 70;
const KEYWORD_EXACT_MATCH_SCORE = 160;
const KEYWORD_PREFIX_MATCH_SCORE = 120;
const KEYWORD_WORD_MATCH_SCORE = 80;
const KEYWORD_SUBSTRING_MATCH_SCORE = 50;
const KIND_EXACT_MATCH_SCORE = 60;
const KIND_PREFIX_MATCH_SCORE = 40;
const KIND_WORD_MATCH_SCORE = 20;
const KIND_SUBSTRING_MATCH_SCORE = 10;

export type CommandPaletteStatus = 'idle' | 'loading' | 'ready' | 'error';
export type CommandPaletteMove = 'next' | 'previous' | 'first' | 'last';
export type CommandPaletteActionId =
  | 'toggle-theme'
  | 'refresh-view'
  | 'logout'
  | 'clear-recents';

export interface CommandPaletteItem {
  id: string;
  label: string;
  meta: string;
  kind: DashboardSearchResult['type'] | 'navigation' | 'action';
  href?: string;
  actionId?: CommandPaletteActionId;
  keywords?: string[];
}

export interface CommandPaletteSection {
  id: string;
  title: string;
  items: CommandPaletteItem[];
}

interface CommandPaletteStateDescriptorInput {
  query: string;
  status: CommandPaletteStatus;
  visibleItemCount: number;
  errorMessage?: string | null;
}

interface CommandPaletteSectionsInput {
  query: string;
  actionItems: CommandPaletteItem[];
  recentItems: CommandPaletteItem[];
  quickLinks: CommandPaletteItem[];
  searchResults: DashboardSearchResult[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredCommandPaletteItem {
  id: string;
  label: string;
  meta: string;
  kind: CommandPaletteItem['kind'];
  href?: string;
  actionId?: CommandPaletteActionId;
  keywords?: string[];
}

const SEARCH_RESULT_SECTION_ORDER: Array<DashboardSearchResult['type']> = [
  'workflow',
  'task',
  'project',
  'playbook',
  'worker',
  'agent',
];

const SEARCH_RESULT_SECTION_LABELS: Record<DashboardSearchResult['type'], string> = {
  workflow: 'Workflows',
  task: 'Tasks',
  project: 'Projects',
  playbook: 'Playbooks',
  worker: 'Workers',
  agent: 'Agents',
};

export function shouldRunCommandPaletteSearch(query: string): boolean {
  return query.trim().length >= COMMAND_PALETTE_MIN_QUERY_LENGTH;
}

export function buildCommandPaletteSearchItems(
  results: DashboardSearchResult[],
  query = '',
): CommandPaletteItem[] {
  const items = results.map((result) => ({
    id: `${result.type}:${result.id}`,
    href: result.href,
    label: result.label,
    meta: result.subtitle,
    kind: result.type,
  }));
  return filterAndRankCommandPaletteItems(items, query, results.length || undefined);
}

export function filterCommandPaletteQuickLinks(
  items: CommandPaletteItem[],
  query: string,
  limit = COMMAND_PALETTE_DEFAULT_LINK_LIMIT,
): CommandPaletteItem[] {
  return filterAndRankCommandPaletteItems(items, query, limit);
}

export function filterAndRankCommandPaletteItems(
  items: CommandPaletteItem[],
  query: string,
  limit?: number,
): CommandPaletteItem[] {
  const normalizedQuery = normalizeCommandPaletteText(query);
  const nextLimit = limit ?? items.length;
  if (!normalizedQuery) {
    return items.slice(0, nextLimit);
  }

  return items
    .map((item, index) => ({
      item,
      index,
      score: scoreCommandPaletteItem(item, normalizedQuery),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.item.label !== right.item.label) {
        return left.item.label.localeCompare(right.item.label);
      }
      return left.index - right.index;
    })
    .slice(0, nextLimit)
    .map((entry) => entry.item);
}

export function buildCommandPaletteSections(
  input: CommandPaletteSectionsInput,
): CommandPaletteSection[] {
  const query = normalizeCommandPaletteText(input.query);
  const sections: CommandPaletteSection[] = [];
  const actionItems = filterAndRankCommandPaletteItems(
    input.actionItems,
    query,
    COMMAND_PALETTE_ACTION_LIMIT,
  );
  const recentItems = filterAndRankCommandPaletteItems(
    input.recentItems,
    query,
    COMMAND_PALETTE_RECENT_LIMIT,
  );
  const quickLinks = filterAndRankCommandPaletteItems(
    input.quickLinks,
    query,
    COMMAND_PALETTE_DEFAULT_LINK_LIMIT,
  );

  pushCommandPaletteSection(sections, 'actions', 'Actions', actionItems);
  pushCommandPaletteSection(sections, 'recent', 'Recent', recentItems);

  if (query && shouldRunCommandPaletteSearch(query)) {
    for (const resultSection of buildSearchResultSections(input.searchResults, query)) {
      sections.push(resultSection);
    }
  }

  pushCommandPaletteSection(sections, 'navigation', query ? 'Jump to' : 'Quick links', quickLinks);
  return sections;
}

export function readRecentCommandPaletteItems(storage = getCommandPaletteStorage()): CommandPaletteItem[] {
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(COMMAND_PALETTE_RECENTS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isStoredCommandPaletteItem).slice(0, COMMAND_PALETTE_RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function recordRecentCommandPaletteItem(
  item: CommandPaletteItem,
  storage = getCommandPaletteStorage(),
): CommandPaletteItem[] {
  if (!storage || !canPersistRecentCommandPaletteItem(item)) {
    return readRecentCommandPaletteItems(storage);
  }
  const next = [
    toStoredCommandPaletteItem(item),
    ...readRecentCommandPaletteItems(storage).filter(
      (entry) => createCommandPalettePersistenceKey(entry) !== createCommandPalettePersistenceKey(item),
    ),
  ].slice(0, COMMAND_PALETTE_RECENT_LIMIT);
  storage.setItem(COMMAND_PALETTE_RECENTS_KEY, JSON.stringify(next));
  return next;
}

export function clearRecentCommandPaletteItems(storage = getCommandPaletteStorage()): CommandPaletteItem[] {
  if (!storage) {
    return [];
  }
  storage.removeItem(COMMAND_PALETTE_RECENTS_KEY);
  return [];
}

export function moveCommandPaletteSelection(
  currentIndex: number,
  itemCount: number,
  direction: CommandPaletteMove,
): number {
  if (itemCount <= 0) {
    return -1;
  }

  if (direction === 'first') {
    return 0;
  }

  if (direction === 'last') {
    return itemCount - 1;
  }

  if (currentIndex < 0) {
    return direction === 'next' ? 0 : itemCount - 1;
  }

  if (direction === 'next') {
    return (currentIndex + 1) % itemCount;
  }

  return (currentIndex - 1 + itemCount) % itemCount;
}

export function describeCommandPaletteState(
  input: CommandPaletteStateDescriptorInput,
): { title: string; detail: string } {
  if (input.status === 'loading') {
    return {
      title: 'Searching and ranking results',
      detail: 'Actions, recent items, and quick links stay available while live results load.',
    };
  }

  if (input.status === 'error') {
    return {
      title: 'Search unavailable',
      detail:
        input.errorMessage?.trim() || 'The dashboard could not load search results right now.',
    };
  }

  if (normalizeCommandPaletteText(input.query)) {
    if (input.visibleItemCount === 0) {
      return {
        title: 'No matches yet',
        detail: 'Try a different name, ID fragment, status keyword, or action verb.',
      };
    }

    return {
      title: 'Commands and results',
      detail: 'Use arrow keys to move, Enter to open or run, and Escape to dismiss.',
    };
  }

  return {
    title: 'Actions, recent items, and quick links',
    detail: 'Use arrow keys to move, Enter to open or run, and Escape to dismiss.',
  };
}

function buildSearchResultSections(
  results: DashboardSearchResult[],
  query: string,
): CommandPaletteSection[] {
  const ranked = buildCommandPaletteSearchItems(results, query);
  return SEARCH_RESULT_SECTION_ORDER.flatMap((kind) => {
    const items = ranked
      .filter((item) => item.kind === kind)
      .slice(0, COMMAND_PALETTE_RESULT_LIMIT_PER_GROUP);
    if (items.length === 0) {
      return [];
    }
    return [{ id: `results:${kind}`, title: SEARCH_RESULT_SECTION_LABELS[kind], items }];
  });
}

function pushCommandPaletteSection(
  sections: CommandPaletteSection[],
  id: string,
  title: string,
  items: CommandPaletteItem[],
): void {
  if (items.length === 0) {
    return;
  }
  sections.push({ id, title, items });
}

function normalizeCommandPaletteText(value: string): string {
  return value.trim().toLowerCase();
}

function scoreCommandPaletteItem(item: CommandPaletteItem, query: string): number {
  return (
    scoreCommandPaletteText(item.label, query, {
      exact: LABEL_EXACT_MATCH_SCORE,
      prefix: LABEL_PREFIX_MATCH_SCORE,
      word: LABEL_WORD_MATCH_SCORE,
      substring: LABEL_SUBSTRING_MATCH_SCORE,
    }) +
    scoreCommandPaletteText(item.meta, query, {
      exact: META_EXACT_MATCH_SCORE,
      prefix: META_PREFIX_MATCH_SCORE,
      word: META_WORD_MATCH_SCORE,
      substring: META_SUBSTRING_MATCH_SCORE,
    }) +
    scoreCommandPaletteText((item.keywords ?? []).join(' '), query, {
      exact: KEYWORD_EXACT_MATCH_SCORE,
      prefix: KEYWORD_PREFIX_MATCH_SCORE,
      word: KEYWORD_WORD_MATCH_SCORE,
      substring: KEYWORD_SUBSTRING_MATCH_SCORE,
    }) +
    scoreCommandPaletteText(item.kind, query, {
      exact: KIND_EXACT_MATCH_SCORE,
      prefix: KIND_PREFIX_MATCH_SCORE,
      word: KIND_WORD_MATCH_SCORE,
      substring: KIND_SUBSTRING_MATCH_SCORE,
    })
  );
}

function scoreCommandPaletteText(
  value: string,
  query: string,
  weights: {
    exact: number;
    prefix: number;
    word: number;
    substring: number;
  },
): number {
  const normalizedValue = normalizeCommandPaletteText(value);
  if (!normalizedValue) {
    return 0;
  }
  if (normalizedValue === query) {
    return weights.exact;
  }
  if (normalizedValue.startsWith(query)) {
    return weights.prefix;
  }
  if (normalizedValue.split(/[^a-z0-9]+/).includes(query)) {
    return weights.word;
  }
  if (normalizedValue.includes(query)) {
    return weights.substring;
  }
  return 0;
}

function getCommandPaletteStorage(): StorageLike | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  return localStorage;
}

function canPersistRecentCommandPaletteItem(item: CommandPaletteItem): boolean {
  return item.actionId !== 'logout' && item.actionId !== 'clear-recents';
}

function createCommandPalettePersistenceKey(item: Pick<CommandPaletteItem, 'id' | 'href' | 'actionId'>): string {
  if (item.actionId) {
    return `action:${item.actionId}`;
  }
  if (item.href) {
    return `href:${item.href}`;
  }
  return item.id;
}

function toStoredCommandPaletteItem(item: CommandPaletteItem): StoredCommandPaletteItem {
  return {
    id: item.id,
    label: item.label,
    meta: item.meta,
    kind: item.kind,
    href: item.href,
    actionId: item.actionId,
    keywords: item.keywords,
  };
}

function isStoredCommandPaletteItem(value: unknown): value is StoredCommandPaletteItem {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.label === 'string' &&
    typeof record.meta === 'string' &&
    typeof record.kind === 'string' &&
    (record.href === undefined || typeof record.href === 'string') &&
    (record.actionId === undefined || typeof record.actionId === 'string') &&
    (record.keywords === undefined ||
      (Array.isArray(record.keywords) && record.keywords.every((entry) => typeof entry === 'string')))
  );
}
