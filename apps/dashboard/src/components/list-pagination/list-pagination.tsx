import { ChevronLeft, ChevronRight } from 'lucide-react';

import { LIST_PAGE_SIZE_OPTIONS } from '../../lib/pagination/list-pagination.js';
import { Button } from '../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';

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
    <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
      <p className="text-sm text-muted">
        Showing {props.start}-{props.end} of {props.totalItems} {props.itemLabel}.
      </p>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <label className="flex items-center gap-2 text-sm whitespace-nowrap">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Page size</span>
          <Select
            value={String(props.pageSize)}
            onValueChange={(value) => props.onPageSizeChange(Number(value))}
          >
            <SelectTrigger aria-label="Page size" className="h-9 w-[88px]">
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
        <span className="text-sm text-muted whitespace-nowrap">
          Page {props.page} of {props.totalPages}
        </span>
        <div className="flex items-center gap-2">
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
