import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LogLevel } from '../ui/level-selector.js';
import type { TimeRange } from '../ui/time-range-picker.js';
import { resolveTimeRange } from '../ui/time-range-picker.js';

export interface LogFilters {
  workspace: string | null;
  workflow: string | null;
  task: string | null;
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
  executionEnvironment: string;
  executionBackend: string[];
  toolOwner: string[];
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
  actors: 'actor_kind',
  executionBackend: 'execution_backend',
  toolOwner: 'tool_owner',
};

export function useLogFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: LogFilters = useMemo(
    () => ({
      workspace: searchParams.get('workspace'),
      workflow: searchParams.get('workflow'),
      task: searchParams.get('task'),
      trace: searchParams.get('trace'),
      sources: parseList(searchParams.get('source')),
      statuses: parseList(searchParams.get('status')),
      categories: parseList(searchParams.get('category')),
      level: (searchParams.get('level') as LogLevel) ?? DEFAULT_LEVEL,
      time: parseTimeRange(searchParams),
      search: searchParams.get('search') ?? '',
      operations: parseList(searchParams.get('operation')),
      roles: parseList(searchParams.get('role')),
      actors: parseList(searchParams.get('actor_kind') ?? searchParams.get('actor_type') ?? searchParams.get('actor')),
      executionEnvironment: searchParams.get('execution_environment') ?? '',
      executionBackend: parseList(searchParams.get('execution_backend')),
      toolOwner: parseList(searchParams.get('tool_owner')),
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
        workspace: string | null;
        workflow: string | null;
        task: string | null;
      },
    ) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);

          if (scope.workspace) {
            next.set('workspace', scope.workspace);
          } else {
            next.delete('workspace');
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

    if (filters.workspace) params.workspace_id = filters.workspace;
    if (filters.workflow) params.workflow_id = filters.workflow;
    if (filters.task) params.task_id = filters.task;
    if (filters.trace) params.trace_id = filters.trace;
    if (filters.sources.length > 0) params.source = filters.sources.join(',');
    if (filters.statuses.length > 0) params.status = filters.statuses.join(',');
    if (filters.categories.length > 0) params.category = filters.categories.join(',');
    params.level = filters.level;
    if (filters.search) params.search = filters.search;
    if (filters.operations.length > 0) params.operation = filters.operations.join(',');
    if (filters.roles.length > 0) params.role = filters.roles.join(',');
    if (filters.actors.length > 0) params.actor_kind = filters.actors.join(',');
    if (filters.executionEnvironment) params.execution_environment = filters.executionEnvironment;
    if (filters.executionBackend.length > 0) {
      params.execution_backend = filters.executionBackend.join(',');
    }
    if (filters.toolOwner.length > 0) {
      params.tool_owner = filters.toolOwner.join(',');
    }

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
