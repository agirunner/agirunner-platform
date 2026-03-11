import { useCallback, useEffect, useRef, useState, useMemo, type ChangeEvent } from 'react';
import { RotateCcw, Search, X } from 'lucide-react';
import { LogEntityScope } from './log-entity-scope.js';
import { LogClassificationTabs } from './log-classification-tabs.js';
import { MultiSelectChips, CATEGORY_OPTIONS } from './ui/multi-select-chips.js';
import { LevelSelector } from './ui/level-selector.js';
import { TimeRangePicker } from './ui/time-range-picker.js';
import { SearchableCombobox, type ComboboxItem } from './ui/searchable-combobox.js';
import { useLogFilters, type LogFilters as LogFilterState } from './hooks/use-log-filters.js';
import { useLogOperations } from './hooks/use-log-operations.js';
import { useLogRoles } from './hooks/use-log-roles.js';
import { SavedViews, type SavedViewFilters } from '../saved-views.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';

const DEBOUNCE_MS = 300;

function useDebounced(
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

function toOperationItems(
  data: { data: { operation: string; count: number }[] } | undefined,
): ComboboxItem[] {
  if (!data?.data) return [];
  return data.data.map((r) => ({
    id: r.operation,
    label: r.operation,
    subtitle: `${r.count} entries`,
  }));
}

function toRoleItems(
  data: { data: { role: string; count: number }[] } | undefined,
): ComboboxItem[] {
  if (!data?.data) return [];
  return data.data.map((r) => ({
    id: r.role,
    label: r.role.charAt(0).toUpperCase() + r.role.slice(1),
    subtitle: `${r.count} entries`,
  }));
}

type ArrayFilterKey = 'operations' | 'roles';

function useArrayToggle(
  current: string[],
  setFilter: (key: ArrayFilterKey, value: string[]) => void,
  filterKey: ArrayFilterKey,
) {
  return useCallback(
    (id: string | null) => {
      if (!id) return;
      const next = current.includes(id)
        ? current.filter((v) => v !== id)
        : [...current, id];
      setFilter(filterKey, next);
    },
    [current, setFilter, filterKey],
  );
}

interface LogFiltersComponentProps {
  hideEntityScope?: boolean;
  compact?: boolean;
  viewMode?: string;
  onViewModeChange?: (mode: string) => void;
}

export function LogFilters({
  hideEntityScope = false,
  compact = false,
  viewMode,
  onViewModeChange,
}: LogFiltersComponentProps = {}): JSX.Element {
  const { filters, setFilter, setEntityScope, resetFilters, replaceAllParams, toQueryParams } = useLogFilters();
  const { data: operationsData } = useLogOperations();
  const { data: rolesData } = useLogRoles();

  const [searchDraft, setSearchDraft] = useState(filters.search);

  const handleSearchCommit = useCallback(
    (committed: string) => setFilter('search', committed),
    [setFilter],
  );

  useDebounced(searchDraft, DEBOUNCE_MS, handleSearchCommit);

  const handleSearchChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setSearchDraft(e.target.value),
    [],
  );

  const toggleOperation = useArrayToggle(filters.operations, setFilter, 'operations');
  const clearOperations = useCallback(() => setFilter('operations', []), [setFilter]);
  const selectedOperationIds = useMemo(() => new Set(filters.operations), [filters.operations]);

  const toggleRole = useArrayToggle(filters.roles, setFilter, 'roles');
  const clearRoles = useCallback(() => setFilter('roles', []), [setFilter]);
  const selectedRoleIds = useMemo(() => new Set(filters.roles), [filters.roles]);

  const operationItems = toOperationItems(operationsData);
  const roleItems = toRoleItems(rolesData);

  const savedViewFilters = useMemo((): SavedViewFilters => {
    const params = toQueryParams();
    const result: SavedViewFilters = {};
    for (const [k, v] of Object.entries(params)) {
      result[k] = v;
    }
    if (viewMode) {
      result.viewMode = viewMode;
    }
    return result;
  }, [toQueryParams, viewMode]);

  const applyFromSavedView = useCallback(
    (saved: SavedViewFilters) => {
      // Map query param keys back to URL param keys in one shot
      const urlParams: Record<string, string> = {};
      for (const [key, value] of Object.entries(saved)) {
        if (!value || key === 'viewMode') continue;
        const urlKey =
          key === 'project_id' ? 'project'
          : key === 'workflow_id' ? 'workflow'
          : key === 'task_id' ? 'task'
          : key === 'trace_id' ? 'trace'
          : key;
        urlParams[urlKey] = value;
      }

      replaceAllParams(urlParams);
      setSearchDraft(saved.search ?? '');
      if (saved.viewMode) onViewModeChange?.(saved.viewMode);
    },
    [replaceAllParams, onViewModeChange],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: Classification tabs + time + level + reset */}
      <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-2">
        <LogClassificationTabs
          activeCategories={filters.categories}
          onChange={(cats) => setFilter('categories', cats)}
        />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <TimeRangePicker
            value={filters.time}
            onChange={(range) => setFilter('time', range)}
          />
          <LevelSelector
            value={filters.level}
            onChange={(level) => setFilter('level', level)}
          />
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset
          </Button>
          <SavedViews
            storageKey="logs"
            currentFilters={savedViewFilters}
            onApply={applyFromSavedView}
          />
        </div>
      </div>

      {/* Row 2: Entity scope + role + operations */}
      <div className="flex flex-wrap items-center gap-2">
        {!hideEntityScope && (
          <LogEntityScope
            projectId={filters.project}
            workflowId={filters.workflow}
            taskId={filters.task}
            onChangeEntity={setEntityScope}
          />
        )}
        <SearchableCombobox
          items={roleItems}
          value={null}
          onChange={toggleRole}
          placeholder={
            filters.roles.length > 0
              ? `${filters.roles.length} role${filters.roles.length > 1 ? 's' : ''}`
              : 'Roles'
          }
          searchPlaceholder="Search roles..."
          allGroupLabel="Roles"
          className="w-36"
          multiSelect
          selectedIds={selectedRoleIds}
          onClearAll={clearRoles}
        />
        <SearchableCombobox
          items={operationItems}
          value={null}
          onChange={toggleOperation}
          placeholder={
            filters.operations.length > 0
              ? `${filters.operations.length} op${filters.operations.length > 1 ? 's' : ''}`
              : 'Operations'
          }
          searchPlaceholder="Search operations..."
          allGroupLabel="Operations"
          className="w-36"
          multiSelect
          selectedIds={selectedOperationIds}
          onClearAll={clearOperations}
        />
      </div>

      {/* Trace filter badge */}
      {filters.trace && (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            Trace: {filters.trace.slice(0, 8)}...
            <button
              type="button"
              className="ml-0.5 rounded-sm hover:bg-primary/20"
              onClick={() => setFilter('trace', null)}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}

      {/* Row 3: Category + status chips, search on right */}
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectChips
          label="Category"
          options={CATEGORY_OPTIONS}
          selected={filters.categories}
          onChange={(next) => setFilter('categories', next)}
        />
        <div className="relative w-full sm:w-48 sm:ml-auto">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <Input
            value={searchDraft}
            onChange={handleSearchChange}
            placeholder="Search logs..."
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>
    </div>
  );
}
