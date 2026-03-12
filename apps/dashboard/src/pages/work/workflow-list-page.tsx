import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search, List, LayoutGrid } from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { SavedViews, type SavedViewFilters } from '../../components/saved-views.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Card, CardContent } from '../../components/ui/card.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '../../components/ui/select.js';
import {
  BOARD_COLUMNS,
  STATUS_FILTERS,
  TYPE_FILTER_LABELS,
  TYPE_FILTERS,
  describeGateSummary,
  describeOperatorSignal,
  describeWorkItemSummary,
  describeWorkflowStage,
  describeWorkflowType,
  formatCost,
  normalizeWorkflows,
  resolveStatus,
  resolveTypeFilter,
  statusBadgeVariant,
  type BoardColumn,
  type StatusFilter,
  type TypeFilter,
  type ViewMode,
  type WorkflowListRecord,
} from './workflow-list-support.js';

/* ------------------------------------------------------------------ */
/*  List View                                                          */
/* ------------------------------------------------------------------ */

function WorkflowTable({ workflows }: { workflows: WorkflowListRecord[] }): JSX.Element {
  if (workflows.length === 0) {
    return <p className="py-8 text-center text-muted">No runs match the current filters.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Board Posture</TableHead>
          <TableHead>Active Stages</TableHead>
          <TableHead>Work Items</TableHead>
          <TableHead>Gates</TableHead>
          <TableHead>Cost</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {workflows.map((wf) => {
          const status = resolveStatus(wf);
          return (
            <TableRow key={wf.id}>
              <TableCell className="font-medium">
                <Link to={`/work/workflows/${wf.id}`} className="text-accent hover:underline">
                  {wf.name}
                </Link>
              </TableCell>
              <TableCell>{wf.project_name ?? '-'}</TableCell>
              <TableCell>{describeWorkflowType(wf)}</TableCell>
              <TableCell>
                <div className="space-y-1">
                  <Badge variant={statusBadgeVariant(status)} className="capitalize">
                    {status}
                  </Badge>
                  <p className="text-xs text-muted">{describeOperatorSignal(wf)}</p>
                </div>
              </TableCell>
              <TableCell className="capitalize">{describeWorkflowStage(wf)}</TableCell>
              <TableCell>{describeWorkItemSummary(wf)}</TableCell>
              <TableCell>{describeGateSummary(wf)}</TableCell>
              <TableCell>{formatCost(wf.cost)}</TableCell>
              <TableCell className="text-muted">
                {new Date(wf.created_at).toLocaleDateString()}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/*  Board View                                                         */
/* ------------------------------------------------------------------ */

function BoardColumnView({
  column,
  workflows,
}: {
  column: BoardColumn;
  workflows: WorkflowListRecord[];
}): JSX.Element {
  return (
    <div className="flex-1 min-w-[200px]">
      <div className="mb-3 flex items-center gap-2">
        <Badge variant={statusBadgeVariant(column)} className="capitalize">
          {column}
        </Badge>
        <span className="text-xs text-muted">{workflows.length}</span>
      </div>
      <div className="space-y-2">
        {workflows.map((wf) => (
          <Link key={wf.id} to={`/work/workflows/${wf.id}`} className="block">
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="p-3">
                <p className="text-sm font-medium truncate">{wf.name}</p>
                <p className="text-xs text-muted mt-1 truncate">
                  {wf.project_name ?? 'No project'}
                </p>
                <div className="mt-2 flex items-center justify-between text-xs text-muted">
                  <span>{describeWorkflowType(wf)}</span>
                  <span>{describeOperatorSignal(wf)}</span>
                </div>
                <p className="mt-2 text-xs text-muted truncate">{describeWorkflowStage(wf)}</p>
                <p className="mt-1 text-xs text-muted truncate">{describeWorkItemSummary(wf)}</p>
                {wf.work_item_summary?.awaiting_gate_count ? (
                  <Badge className="mt-2" variant="warning">
                    {wf.work_item_summary.awaiting_gate_count} gate reviews
                  </Badge>
                ) : null}
              </CardContent>
            </Card>
          </Link>
        ))}
        {workflows.length === 0 && <p className="py-4 text-center text-xs text-muted">No runs</p>}
      </div>
    </div>
  );
}

function WorkflowBoard({ workflows }: { workflows: WorkflowListRecord[] }): JSX.Element {
  const grouped = useMemo(() => {
    const map = new Map<BoardColumn, WorkflowListRecord[]>();
    for (const col of BOARD_COLUMNS) {
      map.set(col, []);
    }
    for (const wf of workflows) {
      const status = resolveStatus(wf) as BoardColumn;
      const bucket = BOARD_COLUMNS.includes(status) ? status : 'planned';
      map.get(bucket)!.push(wf);
    }
    return map;
  }, [workflows]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {BOARD_COLUMNS.map((col) => (
        <BoardColumnView key={col} column={col} workflows={grouped.get(col) ?? []} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

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
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-64" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-red-600">Failed to load delivery boards. Please try again later.</div>
    );
  }

  const allWorkflows = normalizeWorkflows(data);
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredWorkflows = allWorkflows.filter((wf) => {
    const status = resolveStatus(wf);
    const stageSummary = describeWorkflowStage(wf);
    if (statusFilter !== 'all' && status !== statusFilter) return false;
    if (typeFilter !== 'all' && resolveTypeFilter(wf) !== typeFilter) return false;
    if (
      normalizedSearch &&
      !`${wf.name} ${wf.project_name ?? ''} ${stageSummary} ${wf.work_item_summary?.active_stage_names?.join(' ') ?? ''}`
        .toLowerCase()
        .includes(normalizedSearch)
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Delivery Boards</h1>
        <Button asChild>
          <Link to="/config/playbooks/launch">
            <Plus className="h-4 w-4" />
            Launch Playbook
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StatusFilter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'all' ? 'All Postures' : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as TypeFilter)}>
          <SelectTrigger className="w-44">
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

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
          <Input
            placeholder="Search runs, stages, or projects..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <SavedViews
          storageKey="workflow-list"
          currentFilters={{ status: statusFilter, workflowType: typeFilter, search: searchQuery }}
          onApply={(filters: SavedViewFilters) => {
            setStatusFilter((filters.status as StatusFilter) ?? 'all');
            setTypeFilter((filters.workflowType as TypeFilter) ?? 'all');
            setSearchQuery(filters.search ?? '');
          }}
        />

        <div className="ml-auto flex items-center gap-1 rounded-md border border-border p-0.5">
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
            aria-label="List view"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'board' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('board')}
            aria-label="Board view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {viewMode === 'list' ? (
        <WorkflowTable workflows={filteredWorkflows} />
      ) : (
        <WorkflowBoard workflows={filteredWorkflows} />
      )}
    </div>
  );
}
