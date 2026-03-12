import { Search, RotateCcw } from 'lucide-react';

import { Button } from './ui/button.js';
import { Card, CardContent } from './ui/card.js';
import { Input } from './ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import type { InspectorFilters } from './execution-inspector-support.js';

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
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-3 lg:grid-cols-[2fr_repeat(4,minmax(0,1fr))]">
          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Search
            </span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <Input
                className="pl-9"
                value={props.filters.search}
                onChange={(event) =>
                  props.onChange({ ...props.filters, search: event.target.value })
                }
                placeholder="operation, error, payload text"
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
            label="Operation"
            value={props.filters.operation || '__all__'}
            options={props.operationOptions}
            includeAll
            onChange={(value) =>
              props.onChange({ ...props.filters, operation: value === '__all__' ? '' : value })
            }
          />
          <FilterSelect
            label="Role"
            value={props.filters.role || '__all__'}
            options={props.roleOptions}
            includeAll
            onChange={(value) =>
              props.onChange({ ...props.filters, role: value === '__all__' ? '' : value })
            }
          />
          <FilterSelect
            label="Actor"
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
            label="Workflow ID"
            value={props.filters.workflowId}
            onChange={(value) => props.onChange({ ...props.filters, workflowId: value })}
          />
          <FilterInput
            label="Task ID"
            value={props.filters.taskId}
            onChange={(value) => props.onChange({ ...props.filters, taskId: value })}
          />
          <FilterInput
            label="Work Item ID"
            value={props.filters.workItemId}
            onChange={(value) => props.onChange({ ...props.filters, workItemId: value })}
          />
          <FilterInput
            label="Stage Name"
            value={props.filters.stageName}
            onChange={(value) => props.onChange({ ...props.filters, stageName: value })}
          />
          <FilterInput
            label="Activation ID"
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
      </CardContent>
    </Card>
  );
}

function FilterInput(props: {
  label: string;
  value: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">
        {props.label}
      </span>
      <Input value={props.value} onChange={(event) => props.onChange(event.target.value)} />
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
