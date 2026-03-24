import { useCallback, useState, useMemo, useEffect, type ChangeEvent } from 'react';
import { RotateCcw, Search, X } from 'lucide-react';
import { LogEntityScope } from './log-entity-scope.js';
import { LogClassificationTabs } from './log-classification-tabs.js';
import { MultiSelectChips, CATEGORY_OPTIONS } from './ui/multi-select-chips.js';
import { LevelSelector } from './ui/level-selector.js';
import { TimeRangePicker } from './ui/time-range-picker.js';
import { SearchableCombobox } from './ui/searchable-combobox.js';
import { useLogFilters, type LogFilters as LogFilterState } from './hooks/use-log-filters.js';
import { useLogOperations } from './hooks/use-log-operations.js';
import { useLogRoles } from './hooks/use-log-roles.js';
import { useLogActors } from './hooks/use-log-actors.js';
import type { LogActorRecord, LogOperationRecord, LogRoleRecord } from '../../lib/api.js';
import {
  DEBOUNCE_MS,
  STATUS_ITEMS,
  mapSavedViewToUrlParams,
  toActorItems,
  toOperationItems,
  toRoleItems,
  useArrayToggle,
  useDebounced,
} from './log-filters.support.js';
import { SavedViews, type SavedViewFilters } from '../saved-views/saved-views.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { applyLogScope, type LogScope } from './log-scope.js';

interface LogFiltersComponentProps {
  hideEntityScope?: boolean;
  compact?: boolean;
  disableOptionQueries?: boolean;
  viewMode?: string; onViewModeChange?: (mode: string) => void;
  scope?: LogScope;
  operationItemsOverride?: LogOperationRecord[];
  roleItemsOverride?: LogRoleRecord[];
  actorItemsOverride?: LogActorRecord[];
}

export function LogFilters({
  hideEntityScope = false,
  compact = false,
  disableOptionQueries = false,
  viewMode,
  onViewModeChange,
  scope,
  operationItemsOverride,
  roleItemsOverride,
  actorItemsOverride,
}: LogFiltersComponentProps = {}): JSX.Element {
  const { filters, setFilter, setEntityScope, resetFilters, replaceAllParams, toQueryParams } =
    useLogFilters();
  const optionBaseFilters = useMemo(
    () => applyLogScope(toQueryParams(), scope),
    [scope, toQueryParams],
  );
  const operationOptionFilters = useMemo(() => {
    const next = { ...optionBaseFilters };
    delete next.operation;
    return next;
  }, [optionBaseFilters]);
  const roleOptionFilters = useMemo(() => {
    const next = { ...optionBaseFilters };
    delete next.role;
    return next;
  }, [optionBaseFilters]);
  const actorOptionFilters = useMemo(() => {
    const next = { ...optionBaseFilters };
    delete next.actor_kind;
    return next;
  }, [optionBaseFilters]);
  const { data: operationsData } = useLogOperations(
    undefined,
    operationOptionFilters,
    !operationItemsOverride && !disableOptionQueries,
  );
  const { data: rolesData } = useLogRoles(
    roleOptionFilters,
    !roleItemsOverride && !disableOptionQueries,
  );
  const { data: actorsData } = useLogActors(
    actorOptionFilters,
    !actorItemsOverride && !disableOptionQueries,
  );

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

  useEffect(() => setSearchDraft(filters.search), [filters.search]);

  const toggleOperation = useArrayToggle(filters.operations, setFilter, 'operations');
  const clearOperations = useCallback(() => setFilter('operations', []), [setFilter]);
  const selectedOperationIds = useMemo(() => new Set(filters.operations), [filters.operations]);

  const toggleRole = useArrayToggle(filters.roles, setFilter, 'roles');
  const clearRoles = useCallback(() => setFilter('roles', []), [setFilter]);
  const selectedRoleIds = useMemo(() => new Set(filters.roles), [filters.roles]);

  const toggleActor = useArrayToggle(filters.actors, setFilter, 'actors');
  const clearActors = useCallback(() => setFilter('actors', []), [setFilter]);
  const selectedActorIds = useMemo(() => new Set(filters.actors), [filters.actors]);

  const toggleStatus = useCallback(
    (id: string | null) => {
      if (!id) return;
      const next = filters.statuses.includes(id)
        ? filters.statuses.filter((value) => value !== id)
        : [...filters.statuses, id];
      setFilter('statuses', next);
    },
    [filters.statuses, setFilter],
  );
  const clearStatuses = useCallback(() => setFilter('statuses', []), [setFilter]);
  const selectedStatusIds = useMemo(() => new Set(filters.statuses), [filters.statuses]);

  const operationItems = operationItemsOverride ?? toOperationItems(operationsData);
  const roleItems = roleItemsOverride ?? toRoleItems(rolesData);
  const actorItems = actorItemsOverride ?? toActorItems(actorsData);

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
      replaceAllParams(mapSavedViewToUrlParams(saved));
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
          <TimeRangePicker value={filters.time} onChange={(range) => setFilter('time', range)} />
          <LevelSelector value={filters.level} onChange={(level) => setFilter('level', level)} />
          <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <SavedViews
            storageKey="logs"
            currentFilters={savedViewFilters}
            onApply={applyFromSavedView}
            onReset={resetFilters}
          />
        </div>
      </div>

      {/* Row 2: Entity scope + role + operations */}
      <div className="flex flex-wrap items-center gap-2">
        {!hideEntityScope && (
          <LogEntityScope
            workspaceId={filters.workspace}
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
          items={actorItems}
          value={null}
          onChange={toggleActor}
          placeholder={
            filters.actors.length > 0
              ? `${filters.actors.length} actor${filters.actors.length > 1 ? 's' : ''}`
              : 'Actor'
          }
          searchPlaceholder="Search actors..."
          allGroupLabel="Actors"
          className="w-40"
          multiSelect
          selectedIds={selectedActorIds}
          onClearAll={clearActors}
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
        <SearchableCombobox
          items={STATUS_ITEMS}
          value={null}
          onChange={toggleStatus}
          placeholder={
            filters.statuses.length > 0
              ? `${filters.statuses.length} status${filters.statuses.length > 1 ? 'es' : ''}`
              : 'Statuses'
          }
          searchPlaceholder="Search statuses..."
          allGroupLabel="Statuses"
          className="w-40"
          multiSelect
          selectedIds={selectedStatusIds}
          onClearAll={clearStatuses}
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
