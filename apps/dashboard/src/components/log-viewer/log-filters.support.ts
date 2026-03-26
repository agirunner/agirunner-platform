import { useCallback, useEffect, useRef } from 'react';
import type { ComboboxItem } from './ui/searchable-combobox.js';
import type { SavedViewFilters } from '../saved-views/saved-views.js';
import type { LogScope } from './log-scope.js';
import type { LogFilters as LogFilterState } from './hooks/use-log-filters.js';
import { applyLogScope } from './log-scope.js';
import {
  describeActorKindLabel,
  sortActorKinds,
} from './log-actor-presentation.js';

export const DEBOUNCE_MS = 300;

export function useDebounced(
  value: string,
  delayMs: number,
  onDebounced: (value: string) => void,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    timerRef.current = setTimeout(() => onDebounced(value), delayMs);
    return () => clearTimeout(timerRef.current);
  }, [value, delayMs, onDebounced]);
}

export function useArrayToggle(
  current: string[],
  setFilter: (
    key: 'operations' | 'roles' | 'actors' | 'executionBackend' | 'toolOwner',
    value: string[],
  ) => void,
  filterKey: 'operations' | 'roles' | 'actors' | 'executionBackend' | 'toolOwner',
) {
  return useCallback(
    (id: string | null) => {
      if (!id) return;
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
      setFilter(filterKey, next);
    },
    [current, setFilter, filterKey],
  );
}

export function mapSavedViewToUrlParams(saved: SavedViewFilters): Record<string, string> {
  const urlParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(saved)) {
    if (!value || key === 'viewMode') continue;
    const urlKey =
      key === 'workspace_id'
        ? 'workspace'
        : key === 'workflow_id'
          ? 'workflow'
            : key === 'task_id'
              ? 'task'
              : key === 'trace_id'
                ? 'trace'
                : key;
    urlParams[urlKey] = value;
  }
  return urlParams;
}

export function buildFilterOptionScope(
  filters: Pick<LogFilterState, 'workspace' | 'workflow' | 'task'>,
  scope?: LogScope,
): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.workspace) params.workspace_id = filters.workspace;
  if (filters.workflow) params.workflow_id = filters.workflow;
  if (filters.task) params.task_id = filters.task;
  return applyLogScope(params, scope);
}

export function toOperationItems(
  data: { data: { operation: string }[] } | undefined,
): ComboboxItem[] {
  if (!data?.data) return [];
  return data.data.map((row) => ({
    id: row.operation,
    label: row.operation,
  }));
}

export function toRoleItems(
  data: { data: { role: string }[] } | undefined,
): ComboboxItem[] {
  if (!data?.data) return [];
  return data.data.map((row) => ({
    id: row.role,
    label: row.role.charAt(0).toUpperCase() + row.role.slice(1),
  }));
}

export function toActorItems(
  data: {
    data: {
      actor_kind: string;
    }[];
  } | undefined,
): ComboboxItem[] {
  return sortActorKinds(data?.data ?? []).map((row) => ({
    id: row.actor_kind,
    label: describeActorKindLabel(row.actor_kind),
  }));
}

export const SOURCE_ITEMS: ComboboxItem[] = [
  { id: 'runtime', label: 'Specialist Agent', subtitle: 'Specialist agent loop and lifecycle logs' },
  { id: 'task_container', label: 'Specialist Execution', subtitle: 'Specialist execution environment and task process logs' },
  { id: 'container_manager', label: 'Container manager', subtitle: 'Container orchestration' },
  { id: 'platform', label: 'Platform', subtitle: 'Platform and API service logs' },
];

export const STATUS_ITEMS: ComboboxItem[] = [
  { id: 'started', label: 'Started' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
  { id: 'skipped', label: 'Skipped' },
];

export const EXECUTION_BACKEND_ITEMS: ComboboxItem[] = [
  {
    id: 'runtime_only',
    label: 'Specialist agent only',
    subtitle: 'The loop stayed inside the specialist agent process.',
  },
  {
    id: 'runtime_plus_task',
    label: 'Specialist agent + Specialist execution',
    subtitle: 'The loop ran in the specialist agent and used Specialist execution capability.',
  },
];

export const TOOL_OWNER_ITEMS: ComboboxItem[] = [
  {
    id: 'runtime',
    label: 'Specialist Agent',
    subtitle: 'Tool call executed in the specialist agent process.',
  },
  {
    id: 'task',
    label: 'Specialist Execution',
    subtitle: 'Tool call executed inside the specialist execution environment.',
  },
];
