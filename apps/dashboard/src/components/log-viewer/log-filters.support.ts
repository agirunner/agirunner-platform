import { useCallback, useEffect, useRef } from 'react';
import type { ComboboxItem } from './ui/searchable-combobox.js';
import type { SavedViewFilters } from '../saved-views/saved-views.js';
import {
  describeActorKindLabel,
  describeActorComboboxSubtitle,
  sortActorKindRecords,
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

export function toOperationItems(
  data: { data: { operation: string; count: number }[] } | undefined,
): ComboboxItem[] {
  if (!data?.data) return [];
  return data.data.map((row) => ({
    id: row.operation,
    label: row.operation,
    subtitle: `${row.count} entries`,
  }));
}

export function toRoleItems(
  data: { data: { role: string; count: number }[] } | undefined,
): ComboboxItem[] {
  if (!data?.data) return [];
  return data.data.map((row) => ({
    id: row.role,
    label: row.role.charAt(0).toUpperCase() + row.role.slice(1),
    subtitle: `${row.count} entries`,
  }));
}

export function toActorItems(
  data: {
    data: {
      actor_kind: string;
      actor_id: string | null;
      actor_name: string | null;
      latest_role?: string | null;
      latest_workflow_id?: string | null;
      latest_workflow_name?: string | null;
      latest_workflow_label?: string | null;
      count: number;
    }[];
  } | undefined,
): ComboboxItem[] {
  const actorRecords = new Map((data?.data ?? []).map((row) => [row.actor_kind, row] as const));
  const kinds = [
    'orchestrator_agent',
    'specialist_agent',
    'specialist_task_execution',
    'operator',
    'platform_system',
  ];

  return sortActorKindRecords(
    kinds.map((actorKind) => {
      const row = actorRecords.get(actorKind);
      return row ?? { actor_kind: actorKind, actor_id: null, actor_name: null, count: 0 };
    }),
  ).map((row) => ({
    id: row.actor_kind,
    label: describeActorKindLabel(row.actor_kind),
    subtitle:
      row.count > 0
        ? describeActorComboboxSubtitle(row)
        : 'Filter the current results by this actor kind',
  }));
}

export const SOURCE_ITEMS: ComboboxItem[] = [
  { id: 'runtime', label: 'Runtime', subtitle: 'Worker runtime loop' },
  { id: 'task_container', label: 'Task container', subtitle: 'Sandbox and task process logs' },
  { id: 'container_manager', label: 'Container manager', subtitle: 'Container orchestration' },
  { id: 'platform', label: 'Platform', subtitle: 'Platform and API service logs' },
];

export const STATUS_ITEMS: ComboboxItem[] = [
  { id: 'started', label: 'Started', subtitle: 'Work began' },
  { id: 'completed', label: 'Completed', subtitle: 'Work finished successfully' },
  { id: 'failed', label: 'Failed', subtitle: 'Execution or delivery failure' },
  { id: 'skipped', label: 'Skipped', subtitle: 'Execution intentionally skipped' },
];

export const EXECUTION_BACKEND_ITEMS: ComboboxItem[] = [
  {
    id: 'runtime_only',
    label: 'Runtime-only',
    subtitle: 'The loop stayed inside the runtime process.',
  },
  {
    id: 'runtime_plus_task',
    label: 'Runtime + task sandbox',
    subtitle: 'The loop ran in runtime and used task sandbox capability.',
  },
];

export const TOOL_OWNER_ITEMS: ComboboxItem[] = [
  {
    id: 'runtime',
    label: 'Runtime',
    subtitle: 'Tool call executed in the runtime process.',
  },
  {
    id: 'task',
    label: 'Task sandbox',
    subtitle: 'Tool call executed inside the task sandbox.',
  },
];
