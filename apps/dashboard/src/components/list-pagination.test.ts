import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIST_PAGE_SIZE,
  LIST_PAGE_SIZE_OPTIONS,
  paginateListItems,
} from './list-pagination.js';

describe('list pagination', () => {
  it('exposes the standard dashboard page-size options', () => {
    expect(DEFAULT_LIST_PAGE_SIZE).toBe(25);
    expect(LIST_PAGE_SIZE_OPTIONS).toEqual([25, 50, 100]);
  });

  it('pages records and reports the visible range', () => {
    const result = paginateListItems(
      Array.from({ length: 60 }, (_, index) => `row-${index + 1}`),
      2,
      25,
    );

    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(3);
    expect(result.start).toBe(26);
    expect(result.end).toBe(50);
    expect(result.items).toEqual(
      Array.from({ length: 25 }, (_, index) => `row-${index + 26}`),
    );
  });

  it('clamps empty and out-of-range pages safely', () => {
    expect(paginateListItems([], 4, 25)).toEqual({
      items: [],
      page: 1,
      totalItems: 0,
      totalPages: 1,
      start: 0,
      end: 0,
    });

    expect(
      paginateListItems(
        Array.from({ length: 3 }, (_, index) => `row-${index + 1}`),
        8,
        25,
      ),
    ).toMatchObject({
      page: 1,
      totalPages: 1,
      start: 1,
      end: 3,
    });
  });
});
