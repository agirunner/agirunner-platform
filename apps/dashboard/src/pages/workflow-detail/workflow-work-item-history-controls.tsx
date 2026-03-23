import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

import { SavedViews, type SavedViewFilters } from '../../components/saved-views.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import type {
  WorkItemHistoryFilters,
  WorkItemHistorySignalFilter,
  WorkItemHistorySort,
} from './workflow-work-item-history-filters.js';

const SEARCH_DEBOUNCE_MS = 200;

const signalOptions: Array<{ value: WorkItemHistorySignalFilter; label: string }> = [
  { value: 'all', label: 'All signals' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'warning', label: 'Warnings' },
  { value: 'destructive', label: 'Failures and escalations' },
  { value: 'success', label: 'Completed and approved' },
  { value: 'secondary', label: 'General activity' },
];

const sortOptions: Array<{ value: WorkItemHistorySort; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'attention', label: 'Attention first' },
];

export function WorkItemHistoryFilterBar(props: {
  totalCount: number;
  visibleCount: number;
  filters: WorkItemHistoryFilters;
  savedViewFilters: SavedViewFilters;
  savedViewStorageKey: string;
  onQueryChange(value: string): void;
  onSignalChange(value: WorkItemHistorySignalFilter): void;
  onSortChange(value: WorkItemHistorySort): void;
  onApplySavedView(filters: SavedViewFilters): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="grid gap-4 p-4">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Refine the history slice</p>
            <p className="text-xs text-muted">
              {props.visibleCount} of {props.totalCount} event
              {props.totalCount === 1 ? '' : 's'} in the current operator view.
            </p>
          </div>
          <Badge variant="outline">
            {props.filters.query
              ? `Search: ${props.filters.query}`
              : signalOptions.find((option) => option.value === props.filters.signal)?.label
                ?? 'All signals'}
          </Badge>
        </div>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px_220px_auto]">
          <DebouncedSearchInput
            value={props.filters.query}
            onChange={props.onQueryChange}
            placeholder="Search activity, stages, steps, actors, work items, or signal labels"
          />
          <Select
            value={props.filters.signal}
            onValueChange={(value) => props.onSignalChange(value as WorkItemHistorySignalFilter)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {signalOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={props.filters.sort}
            onValueChange={(value) => props.onSortChange(value as WorkItemHistorySort)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SavedViews
            storageKey={props.savedViewStorageKey}
            currentFilters={props.savedViewFilters}
            onApply={props.onApplySavedView}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function DebouncedSearchInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}): JSX.Element {
  const [localValue, setLocalValue] = useState(props.value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;

  useEffect(() => {
    setLocalValue(props.value);
  }, [props.value]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return (
    <div className="relative min-w-0">
      <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <Input
        placeholder={props.placeholder}
        className="pl-9"
        value={localValue}
        onChange={(event) => {
          const newValue = event.target.value;
          setLocalValue(newValue);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(
            () => onChangeRef.current(newValue),
            SEARCH_DEBOUNCE_MS,
          );
        }}
      />
    </div>
  );
}

export function WorkItemHistoryPagination(props: {
  currentPage: number;
  totalPages: number;
  visibleCount: number;
  pageSize: number;
  onPrevious(): void;
  onNext(): void;
}): JSX.Element | null {
  if (props.visibleCount <= props.pageSize) {
    return null;
  }

  const start = props.currentPage * props.pageSize + 1;
  const end = Math.min((props.currentPage + 1) * props.pageSize, props.visibleCount);

  return (
    <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted">
        Showing {start}-{end} of {props.visibleCount} visible events.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={props.currentPage === 0}
          onClick={props.onPrevious}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={props.currentPage >= props.totalPages - 1}
          onClick={props.onNext}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
