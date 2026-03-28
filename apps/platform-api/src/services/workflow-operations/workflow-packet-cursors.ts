interface CursorTarget {
  timestamp: string;
  id: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

const DEFAULT_FETCH_WINDOW = 500;

export function resolveFetchWindow(limit: number): number {
  return Math.max(limit * 4, DEFAULT_FETCH_WINDOW);
}

export function paginateOrderedItems<T>(
  items: T[],
  limit: number,
  after: string | undefined,
  readCursorTarget: (item: T) => CursorTarget | null,
): CursorPage<T> {
  const cursor = parseCursor(after);
  const filtered = cursor
    ? items.filter((item) => {
        const target = readCursorTarget(item);
        if (!target) {
          return false;
        }
        return compareCursorTargets(target, cursor) > 0;
      })
    : items;
  const page = filtered.slice(0, limit);
  return {
    items: page,
    nextCursor:
      filtered.length > limit
        ? encodeCursor(
            requireCursorTarget(
              readCursorTarget(page.at(-1) as T),
              'cursor target missing from page item',
            ),
          )
        : null,
  };
}

export function filterItemsNewerThanCursor<T>(
  items: T[],
  cursor: string | null | undefined,
  readCursorTarget: (item: T) => CursorTarget | null,
): T[] {
  const parsed = parseCursor(cursor ?? undefined);
  if (!parsed) {
    return items;
  }
  return items.filter((item) => {
    const target = readCursorTarget(item);
    if (!target) {
      return false;
    }
    return compareCursorTargets(parsed, target) > 0;
  });
}

export function readFirstItemCursor<T>(
  items: T[],
  readCursorTarget: (item: T) => CursorTarget | null,
): string | null {
  if (items.length === 0) {
    return null;
  }
  const target = readCursorTarget(items[0]);
  return target ? encodeCursor(target) : null;
}

export function compareCursorTargets(left: CursorTarget, right: CursorTarget): number {
  return right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id);
}

export function encodeCursor(target: CursorTarget): string {
  return `${target.timestamp}|${target.id}`;
}

export function parseCursor(cursor: string | undefined): CursorTarget | null {
  if (!cursor) {
    return null;
  }
  const delimiterIndex = cursor.lastIndexOf('|');
  if (delimiterIndex <= 0 || delimiterIndex === cursor.length - 1) {
    return null;
  }
  return {
    timestamp: cursor.slice(0, delimiterIndex),
    id: cursor.slice(delimiterIndex + 1),
  };
}

export function requireCursorTarget(
  target: CursorTarget | null,
  message: string,
): CursorTarget {
  if (!target) {
    throw new Error(message);
  }
  return target;
}
