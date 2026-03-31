export const LIST_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_LIST_PAGE_SIZE = LIST_PAGE_SIZE_OPTIONS[0];

export interface PaginatedListResult<T> {
  items: T[];
  page: number;
  totalItems: number;
  totalPages: number;
  start: number;
  end: number;
}

export function paginateListItems<T>(
  items: T[],
  page: number,
  pageSize: number,
): PaginatedListResult<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = clampPage(page, totalPages);

  if (totalItems === 0) {
    return {
      items: [],
      page: 1,
      totalItems: 0,
      totalPages: 1,
      start: 0,
      end: 0,
    };
  }

  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  return {
    items: items.slice(startIndex, endIndex),
    page: safePage,
    totalItems,
    totalPages,
    start: startIndex + 1,
    end: endIndex,
  };
}

function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  if (page > totalPages) {
    return totalPages;
  }
  return Math.floor(page);
}
