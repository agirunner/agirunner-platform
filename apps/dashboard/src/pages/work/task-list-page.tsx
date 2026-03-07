import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { SavedViews, type SavedViewFilters } from '../../components/saved-views.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
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

interface Task {
  id: string;
  name?: string;
  title?: string;
  status: string;
  state?: string;
  workflow_id?: string;
  workflow_name?: string;
  agent_id?: string;
  agent_name?: string;
  assigned_worker?: string;
  created_at: string;
  duration_seconds?: number;
  started_at?: string;
  completed_at?: string;
}

type StatusFilter =
  | 'all'
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'awaiting_approval';

const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'pending',
  'running',
  'completed',
  'failed',
  'awaiting_approval',
];

const PAGE_SIZE = 20;

function normalizeTasks(response: unknown): Task[] {
  if (Array.isArray(response)) {
    return response as Task[];
  }
  const wrapped = response as { data?: unknown };
  return Array.isArray(wrapped?.data) ? (wrapped.data as Task[]) : [];
}

function resolveStatus(task: Task): string {
  return (task.status ?? task.state ?? 'unknown').toLowerCase();
}

function statusBadgeVariant(status: string) {
  const map: Record<string, 'success' | 'default' | 'destructive' | 'warning' | 'secondary'> = {
    completed: 'success',
    running: 'default',
    failed: 'destructive',
    paused: 'warning',
    pending: 'secondary',
    awaiting_approval: 'warning',
  };
  return map[status] ?? 'secondary';
}

function formatDuration(task: Task): string {
  if (task.duration_seconds !== undefined && task.duration_seconds !== null) {
    const s = task.duration_seconds;
    if (s < 60) return `${Math.round(s)}s`;
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  }
  if (!task.started_at) return '-';
  const start = new Date(task.started_at).getTime();
  const end = task.completed_at ? new Date(task.completed_at).getTime() : Date.now();
  const seconds = (end - start) / 1000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatStatusLabel(status: string): string {
  if (status === 'all') return 'All Statuses';
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function TaskListPage(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => dashboardApi.listTasks(),
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-32" />
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-9 w-48" />
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
      <div className="p-6 text-red-600">Failed to load tasks. Please try again later.</div>
    );
  }

  const allTasks = normalizeTasks(data);
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredTasks = allTasks.filter((task) => {
    const status = resolveStatus(task);
    if (statusFilter !== 'all' && status !== statusFilter) return false;
    if (normalizedSearch) {
      const label = (task.title ?? task.name ?? '').toLowerCase();
      const wfName = (task.workflow_name ?? '').toLowerCase();
      if (!label.includes(normalizedSearch) && !wfName.includes(normalizedSearch)) {
        return false;
      }
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedTasks = filteredTasks.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Tasks</h1>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value as StatusFilter);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s} value={s}>
                {formatStatusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
          <Input
            placeholder="Search tasks..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>

        <SavedViews
          storageKey="task-list"
          currentFilters={{ status: statusFilter, search: searchQuery }}
          onApply={(filters: SavedViewFilters) => {
            setStatusFilter((filters.status as StatusFilter) ?? 'all');
            setSearchQuery(filters.search ?? '');
            setPage(0);
          }}
        />
      </div>

      {paginatedTasks.length === 0 ? (
        <p className="py-8 text-center text-muted">No tasks match the current filters.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Workflow</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedTasks.map((task) => {
              const status = resolveStatus(task);
              return (
                <TableRow key={task.id}>
                  <TableCell className="font-medium">
                    <Link
                      to={`/work/tasks/${task.id}`}
                      className="text-accent hover:underline"
                    >
                      {task.title ?? task.name ?? task.id}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {task.workflow_id ? (
                      <Link
                        to={`/work/workflows/${task.workflow_id}`}
                        className="text-accent hover:underline"
                      >
                        {task.workflow_name ?? task.workflow_id}
                      </Link>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(status)} className="capitalize">
                      {status.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {task.agent_name ?? task.agent_id ?? task.assigned_worker ?? 'Unassigned'}
                  </TableCell>
                  <TableCell className="text-muted">
                    {new Date(task.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{formatDuration(task)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {filteredTasks.length > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">
            Showing {safePage * PAGE_SIZE + 1}-
            {Math.min((safePage + 1) * PAGE_SIZE, filteredTasks.length)} of{' '}
            {filteredTasks.length}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
