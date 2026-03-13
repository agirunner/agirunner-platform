import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LogLevel } from '../ui/level-selector.js';
import type { TimeRange } from '../ui/time-range-picker.js';
import { resolveTimeRange } from '../ui/time-range-picker.js';

export interface LogFilters {
  project: string | null;
  workflow: string | null;
  task: string | null;
  workItem: string | null;
  stage: string | null;
  activation: string | null;
  trace: string | null;
  sources: string[];
  statuses: string[];
  categories: string[];
  level: LogLevel;
  time: TimeRange;
  search: string;
  operations: string[];
  roles: string[];
  actors: string[];
}

const DEFAULT_LEVEL: LogLevel = 'info';
const DEFAULT_TIME_PRESET = '1h';

function parseList(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').filter(Boolean);
}

function serializeList(values: string[]): string | null {
  return values.length > 0 ? values.join(',') : null;
}

function parseTimeRange(params: URLSearchParams): TimeRange {
  const preset = params.get('time');
  const from = params.get('from');
  const to = params.get('to');

  if (from && to) {
    return { preset: null, from, to };
  }
  return { preset: preset ?? DEFAULT_TIME_PRESET, from: null, to: null };
}

const PLURAL_TO_PARAM: Partial<Record<keyof LogFilters, string>> = {
  sources: 'source',
  statuses: 'status',
  categories: 'category',
  operations: 'operation',
  roles: 'role',
  actors: 'actor',
};

export function useLogFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: LogFilters = useMemo(
    () => ({
      project: searchParams.get('project'),
      workflow: searchParams.get('workflow'),
      task: searchParams.get('task'),
      workItem: searchParams.get('work_item'),
      stage: searchParams.get('stage'),
      activation: searchParams.get('activation'),
      trace: searchParams.get('trace'),
      sources: parseList(searchParams.get('source')),
      statuses: parseList(searchParams.get('status')),
      categories: parseList(searchParams.get('category')),
      level: (searchParams.get('level') as LogLevel) ?? DEFAULT_LEVEL,
      time: parseTimeRange(searchParams),
      search: searchParams.get('search') ?? '',
      operations: parseList(searchParams.get('operation')),
      roles: parseList(searchParams.get('role')),
      actors: parseList(searchParams.get('actor')),
    }),
    [searchParams],
  );

  const setFilter = useCallback(
    <K extends keyof LogFilters>(key: K, value: LogFilters[K]) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);

          if (key === 'time') {
            const range = value as TimeRange;
            if (range.preset) {
              next.set('time', range.preset);
              next.delete('from');
              next.delete('to');
            } else if (range.from && range.to) {
              next.delete('time');
              next.set('from', range.from);
              next.set('to', range.to);
            }
            return next;
          }

          const paramKey = PLURAL_TO_PARAM[key] ?? key;

          if (Array.isArray(value)) {
            const serialized = serializeList(value as string[]);
            if (serialized) {
              next.set(paramKey, serialized);
            } else {
              next.delete(paramKey);
            }
          } else if (
            value === null ||
            value === '' ||
            (key === 'level' && value === DEFAULT_LEVEL)
          ) {
            next.delete(paramKey);
          } else {
            next.set(paramKey, String(value));
          }

          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setEntityScope = useCallback(
    (
      scope: {
        project: string | null;
        workflow: string | null;
        task: string | null;
        workItem?: string | null;
        activation?: string | null;
      },
    ) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);

          if (scope.project) {
            next.set('project', scope.project);
          } else {
            next.delete('project');
          }

          if (scope.workflow) {
            next.set('workflow', scope.workflow);
          } else {
            next.delete('workflow');
          }

          if (scope.task) {
            next.set('task', scope.task);
          } else {
            next.delete('task');
          }

          if (scope.workItem) {
            next.set('work_item', scope.workItem);
          } else {
            next.delete('work_item');
          }

          if (scope.activation) {
            next.set('activation', scope.activation);
          } else {
            next.delete('activation');
          }

          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const resetFilters = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const toQueryParams = useCallback((): Record<string, string> => {
    const params: Record<string, string> = {};

    if (filters.project) params.project_id = filters.project;
    if (filters.workflow) params.workflow_id = filters.workflow;
    if (filters.task) params.task_id = filters.task;
    if (filters.workItem) params.work_item_id = filters.workItem;
    if (filters.stage) params.stage_name = filters.stage;
    if (filters.activation) params.activation_id = filters.activation;
    if (filters.trace) params.trace_id = filters.trace;
    if (filters.sources.length > 0) params.source = filters.sources.join(',');
    if (filters.statuses.length > 0) params.status = filters.statuses.join(',');
    if (filters.categories.length > 0) params.category = filters.categories.join(',');
    params.level = filters.level;
    if (filters.search) params.search = filters.search;
    if (filters.operations.length > 0) params.operation = filters.operations.join(',');
    if (filters.roles.length > 0) params.role = filters.roles.join(',');
    if (filters.actors.length > 0) params.actor = filters.actors.join(',');

    const resolved = resolveTimeRange(filters.time);
    if (resolved) {
      params.since = resolved.since;
      params.until = resolved.until;
    }

    return params;
  }, [filters]);

  const replaceAllParams = useCallback(
    (params: Record<string, string>) => {
      setSearchParams(params, { replace: true });
    },
    [setSearchParams],
  );

  return { filters, setFilter, setEntityScope, resetFilters, replaceAllParams, toQueryParams };
}
