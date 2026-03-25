import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { SavedViews, type SavedViewFilters } from '../../components/saved-views/saved-views.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import {
  STATUS_FILTERS,
  TYPE_FILTER_LABELS,
  TYPE_FILTERS,
  describeGateSummary,
  describeWorkflowStage,
  normalizeWorkflows,
  resolveStatus,
  resolveTypeFilter,
  summarizeWorkflowCollection,
  type StatusFilter,
  type TypeFilter,
  type ViewMode,
} from './workflow-list-support.js';
import { WorkflowBoard } from './workflow-list-board-view.js';
import { WorkflowTable } from './workflow-list-layouts.js';
import { WorkflowSummaryCards } from './workflow-list-summary-cards.js';
import { WorkflowListViewToggle } from './workflow-list-view-toggle.js';

export function WorkflowListPage(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const { data, isLoading, error } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => dashboardApi.listWorkflows(),
  });

  if (isLoading) {
    return <WorkflowListPageSkeleton />;
  }

  if (error) {
    return (
      <div className="p-6 text-red-600">
        Failed to load workflows. Please try again later.
      </div>
    );
  }

  const allWorkflows = normalizeWorkflows(data);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredWorkflows = allWorkflows.filter((workflow) => {
    const status = resolveStatus(workflow);
    const stageSummary = describeWorkflowStage(workflow);
    if (statusFilter !== 'all' && status !== statusFilter) {
      return false;
    }
    if (typeFilter !== 'all' && resolveTypeFilter(workflow) !== typeFilter) {
      return false;
    }
    if (!normalizedSearch) {
      return true;
    }
    return `${workflow.name} ${workflow.workspace_name ?? ''} ${stageSummary} ${workflow.work_item_summary?.active_stage_names?.join(' ') ?? ''} ${describeGateSummary(workflow)}`
      .toLowerCase()
      .includes(normalizedSearch);
  });
  const collectionSummary = summarizeWorkflowCollection(filteredWorkflows);

  return (
    <div className="space-y-6 p-6">
      <WorkflowListHeader />

      <WorkflowSummaryCards summary={collectionSummary} />

      <WorkflowFilterCard
        allCount={allWorkflows.length}
        filteredCount={filteredWorkflows.length}
        attentionCount={collectionSummary.gated + collectionSummary.blocked}
        spentBoards={collectionSummary.spentBoards}
        searchQuery={searchQuery}
        statusFilter={statusFilter}
        typeFilter={typeFilter}
        viewMode={viewMode}
        onSearchQueryChange={setSearchQuery}
        onStatusFilterChange={setStatusFilter}
        onTypeFilterChange={setTypeFilter}
        onViewModeChange={setViewMode}
      />

      {viewMode === 'list' ? (
        <WorkflowTable workflows={filteredWorkflows} />
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Board posture view</h2>
            <p className="text-sm text-muted">
              Scan the visible runs by posture, then open a board when something needs action.
            </p>
          </div>
          <WorkflowBoard workflows={filteredWorkflows} />
        </div>
      )}
    </div>
  );
}

function WorkflowListHeader(): JSX.Element {
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="space-y-2">
        <Badge variant="outline" className="w-fit">
          Board operations
        </Badge>
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Workflows</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted">
            Review posture, progress, live stages, gate pressure, and reported spend without
            drilling into every board run.
          </p>
        </div>
      </div>
      <Button asChild className="w-full sm:w-auto">
        <Link to="/design/playbooks/launch">
          <Plus className="h-4 w-4" />
          Launch Playbook
        </Link>
      </Button>
    </div>
  );
}

function WorkflowFilterCard(props: {
  allCount: number;
  filteredCount: number;
  attentionCount: number;
  spentBoards: number;
  searchQuery: string;
  statusFilter: StatusFilter;
  typeFilter: TypeFilter;
  viewMode: ViewMode;
  onSearchQueryChange(value: string): void;
  onStatusFilterChange(value: StatusFilter): void;
  onTypeFilterChange(value: TypeFilter): void;
  onViewModeChange(value: ViewMode): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="grid gap-4 p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Filter the visible board set</p>
            <p className="text-xs text-muted">
              Showing {props.filteredCount} of {props.allCount} board runs, with{' '}
              {props.attentionCount} needing attention and {props.spentBoards} reporting spend in
              the current view.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {props.viewMode === 'list' ? 'List view' : 'Board view'}
            </Badge>
            <Badge variant="outline">
              {props.statusFilter === 'all'
                ? 'All postures'
                : `${props.statusFilter} posture`}
            </Badge>
            <Badge variant="outline">{TYPE_FILTER_LABELS[props.typeFilter]}</Badge>
            {props.searchQuery ? (
              <Badge variant="outline">Search: {props.searchQuery}</Badge>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[11rem_12rem_minmax(0,1fr)_auto]">
          <Select
            value={props.statusFilter}
            onValueChange={(value) => props.onStatusFilterChange(value as StatusFilter)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((status) => (
                <SelectItem key={status} value={status}>
                  {status === 'all'
                    ? 'All Postures'
                    : status.charAt(0).toUpperCase() + status.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={props.typeFilter}
            onValueChange={(value) => props.onTypeFilterChange(value as TypeFilter)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_FILTERS.map((type) => (
                <SelectItem key={type} value={type}>
                  {TYPE_FILTER_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative min-w-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
            <Input
              placeholder="Search runs, stages, gates, or workspaces..."
              className="pl-9"
              value={props.searchQuery}
              onChange={(event) => props.onSearchQueryChange(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 xl:justify-end">
            <SavedViews
              storageKey="workflow-list"
              currentFilters={{
                status: props.statusFilter,
                workflowType: props.typeFilter,
                search: props.searchQuery,
              }}
              onApply={(filters: SavedViewFilters) => {
                props.onStatusFilterChange((filters.status as StatusFilter) ?? 'all');
                props.onTypeFilterChange((filters.workflowType as TypeFilter) ?? 'all');
                props.onSearchQueryChange(filters.search ?? '');
              }}
            />

            <WorkflowListViewToggle
              value={props.viewMode}
              onChange={props.onViewModeChange}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkflowListPageSkeleton(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-5 w-[32rem] max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full" />
        ))}
      </div>
      <Skeleton className="h-36 w-full" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}
