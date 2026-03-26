import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from './ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';

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

export function ListPagination(props: {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  start: number;
  end: number;
  itemLabel: string;
  onPageChange(page: number): void;
  onPageSizeChange(pageSize: number): void;
}): JSX.Element | null {
  if (props.totalItems === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted">
        Showing {props.start}-{props.end} of {props.totalItems} {props.itemLabel}.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="grid gap-1 text-sm sm:min-w-[132px]">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            Page size
          </span>
          <Select
            value={String(props.pageSize)}
            onValueChange={(value) => props.onPageSizeChange(Number(value))}
          >
            <SelectTrigger aria-label="Page size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIST_PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="flex items-center justify-between gap-2 sm:justify-start">
          <span className="text-sm text-muted">
            Page {props.page} of {props.totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.page <= 1}
            onClick={() => props.onPageChange(props.page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.page >= props.totalPages}
            onClick={() => props.onPageChange(props.page + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
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
