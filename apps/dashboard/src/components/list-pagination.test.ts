import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIST_PAGE_SIZE,
  LIST_PAGE_SIZE_OPTIONS,
  paginateListItems,
} from './list-pagination.js';

function readSource(): string {
  return readFileSync(resolve(import.meta.dirname, './list-pagination.tsx'), 'utf8');
}

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

  it('keeps page size, page status, and nav controls on one wrap-safe row', () => {
    const source = readSource();

    expect(source).toContain('className="flex flex-wrap items-center justify-end gap-3"');
    expect(source).toContain('className="flex items-center gap-2 text-sm whitespace-nowrap"');
    expect(source).toContain('className="h-9 w-[88px]"');
    expect(source).not.toContain('className="grid gap-1 text-sm sm:min-w-[132px]"');
    expect(source).not.toContain('className="flex flex-col gap-2 sm:flex-row sm:items-center"');
  });
});
