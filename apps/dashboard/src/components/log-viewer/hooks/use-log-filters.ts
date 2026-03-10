import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LogLevel } from '../ui/level-selector.js';
import type { TimeRange } from '../ui/time-range-picker.js';
import { resolveTimeRange } from '../ui/time-range-picker.js';

export interface LogFilters {
  project: string | null;
  workflow: string | null;
  task: string | null;
  sources: string[];
  categories: string[];
  level: LogLevel;
  time: TimeRange;
  search: string;
  operations: string[];
  actors: string[];
  statuses: string[];
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
  categories: 'category',
  operations: 'operation',
  actors: 'actor',
  statuses: 'status',
};

export function useLogFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: LogFilters = useMemo(
    () => ({
      project: searchParams.get('project'),
      workflow: searchParams.get('workflow'),
      task: searchParams.get('task'),
      sources: parseList(searchParams.get('source')),
      categories: parseList(searchParams.get('category')),
      level: (searchParams.get('level') as LogLevel) ?? DEFAULT_LEVEL,
      time: parseTimeRange(searchParams),
      search: searchParams.get('search') ?? '',
      operations: parseList(searchParams.get('operation')),
      actors: parseList(searchParams.get('actor')),
      statuses: parseList(searchParams.get('status')),
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

  const resetFilters = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const toQueryParams = useCallback((): Record<string, string> => {
    const params: Record<string, string> = {};

    if (filters.project) params.project_id = filters.project;
    if (filters.workflow) params.workflow_id = filters.workflow;
    if (filters.task) params.task_id = filters.task;
    if (filters.sources.length > 0) params.source = filters.sources.join(',');
    if (filters.categories.length > 0) params.category = filters.categories.join(',');
    params.level = filters.level;
    if (filters.search) params.search = filters.search;
    if (filters.operations.length > 0) params.operation = filters.operations.join(',');
    if (filters.actors.length > 0) params.actor = filters.actors.join(',');
    if (filters.statuses.length > 0) params.status = filters.statuses.join(',');

    const resolved = resolveTimeRange(filters.time);
    if (resolved) {
      params.since = resolved.since;
      params.until = resolved.until;
    }

    return params;
  }, [filters]);

  return { filters, setFilter, resetFilters, toQueryParams };
}
