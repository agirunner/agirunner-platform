import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  GitBranch,
  LayoutGrid,
  List,
  Plus,
  Search,
} from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { SavedViews, type SavedViewFilters } from '../../components/saved-views.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import {
  BOARD_COLUMNS,
  STATUS_FILTERS,
  TYPE_FILTER_LABELS,
  TYPE_FILTERS,
  describeGateSummary,
  describeOperatorSignal,
  describeWorkflowCost,
  describeWorkflowProgress,
  describeWorkflowStage,
  describeWorkflowType,
  formatRelativeRunAge,
  normalizeWorkflows,
  resolveStatus,
  resolveTypeFilter,
  statusBadgeVariant,
  summarizeWorkflowCollection,
  type BoardColumn,
  type StatusFilter,
  type TypeFilter,
  type ViewMode,
  type WorkflowListRecord,
} from './workflow-list-support.js';
import {
  describeWorkflowStageFootnote,
  describeWorkflowStageLabel,
} from './workflow-list-stage-presentation.js';
import { WorkflowSummaryCards } from './workflow-list-summary-cards.js';

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
        Failed to load delivery boards. Please try again later.
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
    return `${workflow.name} ${workflow.project_name ?? ''} ${stageSummary} ${workflow.work_item_summary?.active_stage_names?.join(' ') ?? ''} ${describeGateSummary(workflow)}`
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
          <h1 className="text-3xl font-semibold tracking-tight">Delivery Boards</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted">
            Review posture, progress, live stages, gate pressure, and reported spend without
            drilling into every board run.
          </p>
        </div>
      </div>
      <Button asChild className="w-full sm:w-auto">
        <Link to="/config/playbooks/launch">
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
              placeholder="Search runs, stages, gates, or projects..."
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

            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              <Button
                variant={props.viewMode === 'list' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => props.onViewModeChange('list')}
                aria-label="List view"
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={props.viewMode === 'board' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => props.onViewModeChange('board')}
                aria-label="Board view"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkflowTable({ workflows }: { workflows: WorkflowListRecord[] }): JSX.Element {
  if (workflows.length === 0) {
    return <EmptyWorkflowState />;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:hidden">
        {workflows.map((workflow) => (
          <WorkflowListCard key={workflow.id} workflow={workflow} />
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-xl border border-border/70 bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Board</TableHead>
              <TableHead>Posture</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Gates</TableHead>
              <TableHead>Spend</TableHead>
              <TableHead>Age</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workflows.map((workflow) => {
              const status = resolveStatus(workflow);
              return (
                <TableRow key={workflow.id}>
                  <TableCell className="align-top">
                    <div className="space-y-1">
                      <Link
                        to={`/work/workflows/${workflow.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {workflow.name}
                      </Link>
                      <div className="flex flex-wrap gap-2 text-xs text-muted">
                        <span>{workflow.project_name ?? 'No project linked'}</span>
                        <span>{describeWorkflowType(workflow)}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="space-y-1">
                      <Badge variant={statusBadgeVariant(status)} className="capitalize">
                        {status}
                      </Badge>
                      <p className="max-w-56 text-xs text-muted">
                        {describeOperatorSignal(workflow)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="space-y-1 text-sm">
                      <p>{describeWorkflowStage(workflow)}</p>
                      <p className="text-xs text-muted">
                        {describeWorkflowProgress(workflow)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    {describeGateSummary(workflow)}
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    {describeWorkflowCost(workflow)}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="space-y-1 text-sm">
                      <p>{formatRelativeRunAge(workflow.created_at)}</p>
                      <p className="text-xs text-muted">
                        {new Date(workflow.created_at).toLocaleString()}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function WorkflowListCard({ workflow }: { workflow: WorkflowListRecord }): JSX.Element {
  const status = resolveStatus(workflow);
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="grid gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <Link
              to={`/work/workflows/${workflow.id}`}
              className="block truncate text-base font-semibold text-accent hover:underline"
            >
              {workflow.name}
            </Link>
            <p className="text-sm text-muted">{workflow.project_name ?? 'No project linked'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusBadgeVariant(status)} className="capitalize">
              {status}
            </Badge>
            <Badge variant="outline">{describeWorkflowType(workflow)}</Badge>
          </div>
        </div>
        <p className="text-sm text-foreground">{describeOperatorSignal(workflow)}</p>
        <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 sm:grid-cols-2">
          <WorkflowInfo
            label={describeWorkflowStageLabel(workflow)}
            value={describeWorkflowStage(workflow)}
          />
          <WorkflowInfo label="Progress" value={describeWorkflowProgress(workflow)} />
          <WorkflowInfo label="Gates" value={describeGateSummary(workflow)} />
          <WorkflowInfo label="Spend" value={describeWorkflowCost(workflow)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">{formatRelativeRunAge(workflow.created_at)}</p>
          <Button size="sm" asChild>
            <Link to={`/work/workflows/${workflow.id}`}>Open board</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkflowBoard({ workflows }: { workflows: WorkflowListRecord[] }): JSX.Element {
  const grouped = useMemo(() => {
    const map = new Map<BoardColumn, WorkflowListRecord[]>();
    for (const column of BOARD_COLUMNS) {
      map.set(column, []);
    }
    for (const workflow of workflows) {
      const status = resolveStatus(workflow) as BoardColumn;
      const bucket = BOARD_COLUMNS.includes(status) ? status : 'planned';
      map.get(bucket)?.push(workflow);
    }
    return map;
  }, [workflows]);

  if (workflows.length === 0) {
    return <EmptyWorkflowState />;
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {BOARD_COLUMNS.map((column) => (
        <BoardColumnView
          key={column}
          column={column}
          workflows={grouped.get(column) ?? []}
        />
      ))}
    </div>
  );
}

function BoardColumnView(props: {
  column: BoardColumn;
  workflows: WorkflowListRecord[];
}): JSX.Element {
  return (
    <div className="min-w-[280px] flex-1 rounded-2xl border border-border/70 bg-card/70 p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="space-y-1">
          <Badge variant={statusBadgeVariant(props.column)} className="capitalize">
            {props.column}
          </Badge>
          <p className="text-xs text-muted">
            {describeColumnSummary(props.column, props.workflows.length)}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {props.workflows.length}
        </span>
      </div>
      <div className="space-y-3">
        {props.workflows.map((workflow) => (
          <Link key={workflow.id} to={`/work/workflows/${workflow.id}`} className="block">
            <Card className="border-border/70 transition-shadow hover:shadow-md">
              <CardContent className="grid gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-semibold">{workflow.name}</p>
                    <p className="truncate text-xs text-muted">
                      {workflow.project_name ?? 'No project'}
                    </p>
                  </div>
                  <Badge variant="outline">{describeWorkflowType(workflow)}</Badge>
                </div>
                <p className="text-xs text-foreground">{describeOperatorSignal(workflow)}</p>
                <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs sm:grid-cols-2">
                  <WorkflowInfo
                    label={describeWorkflowStageLabel(workflow)}
                    value={describeWorkflowStage(workflow)}
                  />
                  <WorkflowInfo label="Progress" value={describeWorkflowProgress(workflow)} />
                  <WorkflowInfo label="Gates" value={describeGateSummary(workflow)} />
                  <WorkflowInfo label="Spend" value={describeWorkflowCost(workflow)} />
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-muted">
                  <span>{formatRelativeRunAge(workflow.created_at)}</span>
                  <span>{describeWorkflowStageFootnote(workflow)}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {props.workflows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 px-4 py-6 text-center text-xs text-muted">
            No boards in this posture.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WorkflowInfo(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {props.label}
      </p>
      <p className="text-sm text-foreground">{props.value}</p>
    </div>
  );
}

function EmptyWorkflowState(): JSX.Element {
  return (
    <Card className="border-dashed border-border/70 bg-muted/10">
      <CardContent className="grid gap-2 px-6 py-10 text-center">
        <p className="text-base font-semibold text-foreground">
          No runs match the current filters.
        </p>
        <p className="text-sm text-muted">
          Clear the filters or launch a new playbook run to start tracking delivery posture here.
        </p>
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

function describeColumnSummary(column: BoardColumn, count: number): string {
  if (count === 0) {
    return 'Nothing queued right now';
  }
  switch (column) {
    case 'active':
      return `${count} board run${count === 1 ? '' : 's'} currently moving work`;
    case 'gated':
      return `${count} board run${count === 1 ? '' : 's'} waiting on human review`;
    case 'blocked':
      return `${count} board run${count === 1 ? '' : 's'} need intervention`;
    case 'done':
      return `${count} board run${count === 1 ? '' : 's'} are fully delivered`;
    default:
      return `${count} board run${count === 1 ? '' : 's'} planned but not moving yet`;
  }
}
