import type { DashboardSearchResult } from '../lib/api.js';

export const COMMAND_PALETTE_MIN_QUERY_LENGTH = 2;
export const COMMAND_PALETTE_DEBOUNCE_MS = 180;
export const COMMAND_PALETTE_DEFAULT_LINK_LIMIT = 8;

export type CommandPaletteStatus = 'idle' | 'loading' | 'ready' | 'error';
export type CommandPaletteMove = 'next' | 'previous' | 'first' | 'last';

export interface CommandPaletteItem {
  id: string;
  href: string;
  label: string;
  meta: string;
  kind: DashboardSearchResult['type'] | 'navigation';
}

interface CommandPaletteStateDescriptorInput {
  query: string;
  status: CommandPaletteStatus;
  visibleItemCount: number;
  errorMessage?: string | null;
}

export function shouldRunCommandPaletteSearch(query: string): boolean {
  return query.trim().length >= COMMAND_PALETTE_MIN_QUERY_LENGTH;
}

export function buildCommandPaletteSearchItems(
  results: DashboardSearchResult[],
): CommandPaletteItem[] {
  return results.map((result) => ({
    id: `${result.type}:${result.id}`,
    href: result.href,
    label: result.label,
    meta: result.subtitle,
    kind: result.type,
  }));
}

export function filterCommandPaletteQuickLinks(
  items: CommandPaletteItem[],
  query: string,
  limit = COMMAND_PALETTE_DEFAULT_LINK_LIMIT,
): CommandPaletteItem[] {
  const normalized = query.trim().toLowerCase();
  const visible = normalized
    ? items.filter((item) =>
        `${item.label} ${item.meta}`.toLowerCase().includes(normalized),
      )
    : items;
  return visible.slice(0, limit);
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
      title: 'Searching the workspace',
      detail: 'Results update as you type. Keep typing to narrow the matches.',
    };
  }

  if (input.status === 'error') {
    return {
      title: 'Search unavailable',
      detail:
        input.errorMessage?.trim() || 'The dashboard could not load search results right now.',
    };
  }

  if (shouldRunCommandPaletteSearch(input.query)) {
    if (input.visibleItemCount === 0) {
      return {
        title: 'No matches yet',
        detail: 'Try a different name, ID fragment, or status keyword.',
      };
    }

    return {
      title: 'Live results',
      detail: 'Use arrow keys to move, Enter to open, and Escape to dismiss.',
    };
  }

  if (input.visibleItemCount === 0) {
    return {
      title: 'Type to search',
      detail: `Enter at least ${COMMAND_PALETTE_MIN_QUERY_LENGTH} characters to search workflows, tasks, projects, and more.`,
    };
  }

  return {
    title: 'Quick links',
    detail: 'Jump to common destinations immediately, or keep typing to search everything.',
  };
}
