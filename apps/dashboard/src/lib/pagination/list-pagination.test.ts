import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIST_PAGE_SIZE,
  LIST_PAGE_SIZE_OPTIONS,
  paginateListItems,
} from './list-pagination.js';

describe('list pagination helpers', () => {
  it('keeps the existing page size defaults for dashboard lists', () => {
    expect(LIST_PAGE_SIZE_OPTIONS).toEqual([25, 50, 100]);
    expect(DEFAULT_LIST_PAGE_SIZE).toBe(25);
  });

  it('returns an empty first page when no items are available', () => {
    expect(paginateListItems([], 3, DEFAULT_LIST_PAGE_SIZE)).toEqual({
      items: [],
      page: 1,
      totalItems: 0,
      totalPages: 1,
      start: 0,
      end: 0,
    });
  });

  it('clamps the requested page and preserves the displayed item range', () => {
    expect(paginateListItems([1, 2, 3, 4, 5], 4, 2)).toEqual({
      items: [5],
      page: 3,
      totalItems: 5,
      totalPages: 3,
      start: 5,
      end: 5,
    });
  });
});
