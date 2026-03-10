import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search, List, LayoutGrid } from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import type { DashboardTemplate, DashboardProjectRecord } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
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

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Workflow {
  id: string;
  name: string;
  project_name?: string;
  project_id?: string;
  template_name?: string;
  status: string;
  state?: string;
  current_phase?: string;
  task_counts?: Record<string, number>;
  cost?: number;
  created_at: string;
}

type StatusFilter = 'all' | 'running' | 'completed' | 'failed' | 'paused' | 'pending';
type ViewMode = 'list' | 'board';

const STATUS_FILTERS: StatusFilter[] = ['all', 'running', 'completed', 'failed', 'paused', 'pending'];

const BOARD_COLUMNS = ['pending', 'running', 'paused', 'completed', 'failed'] as const;
type BoardColumn = (typeof BOARD_COLUMNS)[number];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function normalizeWorkflows(response: unknown): Workflow[] {
  if (Array.isArray(response)) return response as Workflow[];
  const wrapped = response as { data?: unknown };
  return Array.isArray(wrapped?.data) ? (wrapped.data as Workflow[]) : [];
}

function normalizeTemplates(response: { data: DashboardTemplate[] }): DashboardTemplate[] {
  return response?.data ?? [];
}

function normalizeProjects(
  response: { data: DashboardProjectRecord[] } | DashboardProjectRecord[],
): DashboardProjectRecord[] {
  if (Array.isArray(response)) return response;
  return response?.data ?? [];
}

function resolveStatus(workflow: Workflow): string {
  return (workflow.status ?? workflow.state ?? 'unknown').toLowerCase();
}

function statusBadgeVariant(status: string) {
  const map: Record<string, 'success' | 'default' | 'destructive' | 'warning' | 'secondary'> = {
    completed: 'success',
    running: 'default',
    failed: 'destructive',
    paused: 'warning',
    pending: 'secondary',
  };
  return map[status] ?? 'secondary';
}

function formatTaskProgress(counts?: Record<string, number>): string {
  if (!counts) return '-';
  const completed = counts.completed ?? 0;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return `${completed}/${total}`;
}

function formatCost(cost?: number): string {
  if (cost === undefined || cost === null) return '-';
  return `$${cost.toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/*  List View                                                          */
/* ------------------------------------------------------------------ */

function WorkflowTable({ workflows }: { workflows: Workflow[] }): JSX.Element {
  if (workflows.length === 0) {
    return (
      <p className="py-8 text-center text-muted">No workflows match the current filters.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Phase</TableHead>
          <TableHead>Tasks</TableHead>
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
                <Link
                  to={`/work/workflows/${wf.id}`}
                  className="text-accent hover:underline"
                >
                  {wf.name}
                </Link>
              </TableCell>
              <TableCell>{wf.project_name ?? '-'}</TableCell>
              <TableCell>
                <Badge variant={statusBadgeVariant(status)} className="capitalize">
                  {status}
                </Badge>
              </TableCell>
              <TableCell className="capitalize">{wf.current_phase ?? '-'}</TableCell>
              <TableCell>{formatTaskProgress(wf.task_counts)}</TableCell>
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
  workflows: Workflow[];
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
                  <span>{wf.template_name ?? '-'}</span>
                  <span>{formatTaskProgress(wf.task_counts)} tasks</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {workflows.length === 0 && (
          <p className="py-4 text-center text-xs text-muted">None</p>
        )}
      </div>
    </div>
  );
}

function WorkflowBoard({ workflows }: { workflows: Workflow[] }): JSX.Element {
  const grouped = useMemo(() => {
    const map = new Map<BoardColumn, Workflow[]>();
    for (const col of BOARD_COLUMNS) {
      map.set(col, []);
    }
    for (const wf of workflows) {
      const status = resolveStatus(wf) as BoardColumn;
      const bucket = BOARD_COLUMNS.includes(status) ? status : 'pending';
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
      <div className="p-6 text-red-600">Failed to load workflows. Please try again later.</div>
    );
  }

  const allWorkflows = normalizeWorkflows(data);
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredWorkflows = allWorkflows.filter((wf) => {
    const status = resolveStatus(wf);
    if (statusFilter !== 'all' && status !== statusFilter) return false;
    if (normalizedSearch && !wf.name.toLowerCase().includes(normalizedSearch)) return false;
    return true;
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Workflows</h1>
        <Button asChild>
          <Link to="/config/templates/launch">
            <Plus className="h-4 w-4" />
            Launch Workflow
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
                {s === 'all' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
          <Input
            placeholder="Search workflows..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <SavedViews
          storageKey="workflow-list"
          currentFilters={{ status: statusFilter, search: searchQuery }}
          onApply={(filters: SavedViewFilters) => {
            setStatusFilter((filters.status as StatusFilter) ?? 'all');
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
