import { useState, useCallback, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, RotateCcw } from 'lucide-react';

import { Button } from '../ui/button.js';
import { Card, CardContent } from '../ui/card.js';
import { Input } from '../ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import {
  DEFAULT_INSPECTOR_FILTERS,
  type InspectorFilters,
} from './execution-inspector-support.js';
import { useDebounced, DEBOUNCE_MS } from '../log-viewer/log-filters.support.js';

interface ExecutionInspectorFilterBarProps {
  filters: InspectorFilters;
  operationOptions: Array<{ value: string; label: string }>;
  roleOptions: Array<{ value: string; label: string }>;
  actorOptions: Array<{ value: string; label: string }>;
  onChange(next: InspectorFilters): void;
  onReset(): void;
}

const TIME_WINDOWS = [
  { value: '1', label: 'Last hour' },
  { value: '6', label: 'Last 6 hours' },
  { value: '24', label: 'Last 24 hours' },
  { value: '168', label: 'Last 7 days' },
] as const;

const LEVEL_OPTIONS = [
  { value: 'debug', label: 'Debug+' },
  { value: 'info', label: 'Info+' },
  { value: 'warn', label: 'Warn+' },
  { value: 'error', label: 'Errors only' },
] as const;

export function ExecutionInspectorFilterBar(
  props: ExecutionInspectorFilterBarProps,
): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const activeFilterCount = countActiveFilters(props.filters);

  const [searchDraft, setSearchDraft] = useDebouncedDraft(
    props.filters.search,
    (value) => props.onChange({ ...props.filters, search: value }),
  );

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          onClick={() => setIsExpanded((current) => !current)}
        >
          <div className="space-y-1">
            <p className="text-sm font-medium">Focus the execution slice</p>
            {!isExpanded ? (
              <p className="text-sm text-muted">
                {activeFilterCount > 0
                  ? `${activeFilterCount} active filter${activeFilterCount > 1 ? 's' : ''} applied`
                  : 'Tap to narrow by board, step, stage, activation, role, or emitter'}
              </p>
            ) : (
              <p className="text-sm text-muted">
                Narrow the inspector by board, specialist step, stage, activation, role, or runtime emitter.
              </p>
            )}
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
          )}
        </button>

        {isExpanded ? (
          <>
            <div className="grid gap-3 lg:grid-cols-[2fr_repeat(4,minmax(0,1fr))]">
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Search
                </span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
                  <Input
                    className="pl-9"
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    placeholder="operation, board, step, error, or payload text"
                  />
                </div>
              </label>
              <FilterSelect
                label="Time window"
                value={props.filters.timeWindowHours}
                options={TIME_WINDOWS}
                onChange={(value) => props.onChange({ ...props.filters, timeWindowHours: value })}
              />
              <FilterSelect
                label="Level"
                value={props.filters.level}
                options={LEVEL_OPTIONS}
                onChange={(value) => props.onChange({ ...props.filters, level: value })}
              />
              <FilterSelect
                label="Activity"
                value={props.filters.operation || '__all__'}
                options={props.operationOptions}
                includeAll
                onChange={(value) =>
                  props.onChange({ ...props.filters, operation: value === '__all__' ? '' : value })
                }
              />
              <FilterSelect
                label="Step role"
                value={props.filters.role || '__all__'}
                options={props.roleOptions}
                includeAll
                onChange={(value) =>
                  props.onChange({ ...props.filters, role: value === '__all__' ? '' : value })
                }
              />
              <FilterSelect
                label="Emitter"
                value={props.filters.actor || '__all__'}
                options={props.actorOptions}
                includeAll
                onChange={(value) =>
                  props.onChange({ ...props.filters, actor: value === '__all__' ? '' : value })
                }
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <FilterInput
                label="Board ID"
                value={props.filters.workflowId}
                onChange={(value) => props.onChange({ ...props.filters, workflowId: value })}
              />
              <FilterInput
                label="Step ID"
                value={props.filters.taskId}
                onChange={(value) => props.onChange({ ...props.filters, taskId: value })}
              />
              <FilterInput
                label="Work item ID"
                value={props.filters.workItemId}
                onChange={(value) => props.onChange({ ...props.filters, workItemId: value })}
              />
              <FilterInput
                label="Stage"
                value={props.filters.stageName}
                onChange={(value) => props.onChange({ ...props.filters, stageName: value })}
              />
              <FilterInput
                label="Activation"
                value={props.filters.activationId}
                onChange={(value) => props.onChange({ ...props.filters, activationId: value })}
              />
            </div>

            <div className="flex justify-end">
              <Button variant="outline" onClick={props.onReset}>
                <RotateCcw className="h-4 w-4" />
                Reset Filters
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function countActiveFilters(filters: InspectorFilters): number {
  let count = 0;
  if (filters.search.trim().length > 0) count++;
  if (filters.workflowId.trim().length > 0) count++;
  if (filters.taskId.trim().length > 0) count++;
  if (filters.workItemId.trim().length > 0) count++;
  if (filters.stageName.trim().length > 0) count++;
  if (filters.activationId.trim().length > 0) count++;
  if (filters.operation.trim().length > 0) count++;
  if (filters.role.trim().length > 0) count++;
  if (filters.actor.trim().length > 0) count++;
  if (filters.level !== DEFAULT_INSPECTOR_FILTERS.level) count++;
  if (filters.timeWindowHours !== DEFAULT_INSPECTOR_FILTERS.timeWindowHours) count++;
  return count;
}

function useDebouncedDraft(
  externalValue: string,
  commit: (value: string) => void,
): [string, (next: string) => void] {
  const [draft, setDraft] = useState(externalValue);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const stableCommit = useCallback((v: string) => commitRef.current(v), []);
  useDebounced(draft, DEBOUNCE_MS, stableCommit);
  useEffect(() => setDraft(externalValue), [externalValue]);

  return [draft, setDraft];
}

function FilterInput(props: {
  label: string;
  value: string;
  onChange(value: string): void;
}): JSX.Element {
  const [draft, setDraft] = useDebouncedDraft(props.value, props.onChange);

  return (
    <label className="space-y-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">
        {props.label}
      </span>
      <Input value={draft} onChange={(event) => setDraft(event.target.value)} />
    </label>
  );
}

function FilterSelect(props: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  includeAll?: boolean;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">
        {props.label}
      </span>
      <Select value={props.value} onValueChange={props.onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.includeAll ? <SelectItem value="__all__">All</SelectItem> : null}
          {props.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
