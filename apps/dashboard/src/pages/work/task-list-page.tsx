import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
} from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { SavedViews, type SavedViewFilters } from '../../components/saved-views.js';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  buildTaskSearchText,
  describeTaskKind,
  describeTaskNextAction,
  describeTaskScope,
  formatRelativeTime,
  formatStatusLabel,
  formatTaskDuration,
  resolveTaskStatus,
  statusBadgeVariant,
  summarizeTaskPosture,
  type TaskListRecord,
} from './task-list-page.support.js';

type StatusFilter =
  | 'all'
  | 'ready'
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'awaiting_approval'
  | 'output_pending_review'
  | 'escalated';

const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'ready',
  'pending',
  'in_progress',
  'completed',
  'failed',
  'awaiting_approval',
  'output_pending_review',
  'escalated',
];

const PAGE_SIZE = 20;

function normalizeTasks(response: unknown): TaskListRecord[] {
  if (Array.isArray(response)) {
    return response as TaskListRecord[];
  }
  const wrapped = response as { data?: unknown };
  return Array.isArray(wrapped?.data) ? (wrapped.data as TaskListRecord[]) : [];
}

export function TaskListPage(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: () => dashboardApi.listTasks(),
  });

  const allTasks = useMemo(() => normalizeTasks(tasksQuery.data), [tasksQuery.data]);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredTasks = useMemo(
    () =>
      allTasks.filter((task) => {
        const status = resolveTaskStatus(task);
        if (statusFilter !== 'all' && status !== statusFilter) {
          return false;
        }
        return normalizedSearch ? buildTaskSearchText(task).includes(normalizedSearch) : true;
      }),
    [allTasks, normalizedSearch, statusFilter],
  );
  const posture = useMemo(() => summarizeTaskPosture(filteredTasks), [filteredTasks]);
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedTasks = filteredTasks.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );

  if (tasksQuery.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (tasksQuery.error) {
    return (
      <div className="p-6 text-red-600">
        Failed to load execution steps. Please retry when the operator API is reachable.
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Execution Steps</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Operator view of specialist steps, reviews, escalations, and orchestrator turns. Lead
          with the next action, then open the step or board only when you need deeper context.
        </p>
      </div>

      <TaskListFilters
        filteredCount={filteredTasks.length}
        searchQuery={searchQuery}
        statusFilter={statusFilter}
        onSearchChange={(value) => {
          setSearchQuery(value);
          setPage(0);
        }}
        onStatusChange={(value) => {
          setStatusFilter(value);
          setPage(0);
        }}
      />

      <TaskPostureSection posture={posture} />

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle>Visible execution steps</CardTitle>
          <p className="text-sm text-muted">
            Every row or card leads with current posture, board context, and recovery path instead
            of a raw task dump.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {paginatedTasks.length === 0 ? (
            <TaskListEmptyState hasFilters={statusFilter !== 'all' || normalizedSearch.length > 0} />
          ) : (
            <>
              <div className="grid gap-3 lg:hidden">
                {paginatedTasks.map((task) => (
                  <TaskMobileCard key={task.id} task={task} />
                ))}
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Step</TableHead>
                      <TableHead>Board context</TableHead>
                      <TableHead>Next action</TableHead>
                      <TableHead>Operator owner</TableHead>
                      <TableHead>Timing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedTasks.map((task) => (
                      <TaskTableRow key={task.id} task={task} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
          <TaskPagination
            filteredCount={filteredTasks.length}
            page={safePage}
            totalPages={totalPages}
            onPrevious={() => setPage((current) => Math.max(0, current - 1))}
            onNext={() => setPage((current) => current + 1)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function TaskListFilters(props: {
  filteredCount: number;
  searchQuery: string;
  statusFilter: StatusFilter;
  onSearchChange(value: string): void;
  onStatusChange(value: StatusFilter): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="grid gap-4 p-4">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Filter the execution queue</p>
            <p className="text-xs text-muted">
              {props.filteredCount} step{props.filteredCount === 1 ? '' : 's'} in the current
              operator view.
            </p>
          </div>
          <Badge variant="outline">
            {props.searchQuery ? `Search: ${props.searchQuery}` : formatStatusLabel(props.statusFilter)}
          </Badge>
        </div>
        <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)_auto]">
          <Select value={props.statusFilter} onValueChange={(value) => props.onStatusChange(value as StatusFilter)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((status) => (
                <SelectItem key={status} value={status}>
                  {formatStatusLabel(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative min-w-0">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              placeholder="Search steps, boards, stages, activations, people, or work items"
              className="pl-9"
              value={props.searchQuery}
              onChange={(event) => props.onSearchChange(event.target.value)}
            />
          </div>
          <SavedViews
            storageKey="task-list"
            currentFilters={{ status: props.statusFilter, search: props.searchQuery } as SavedViewFilters}
            onApply={(filters: SavedViewFilters) => {
              props.onStatusChange((filters.status as StatusFilter) ?? 'all');
              props.onSearchChange(filters.search ?? '');
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function TaskPostureSection(props: {
  posture: ReturnType<typeof summarizeTaskPosture>;
}): JSX.Element {
  const packets = [
    {
      title: 'Execution pressure',
      value: `${props.posture.active} active`,
      detail: `${props.posture.ready} ready and waiting for worker capacity`,
      icon: Loader2,
    },
    {
      title: 'Review queue',
      value: `${props.posture.review} waiting`,
      detail: 'Approvals and output reviews that need an operator decision',
      icon: CheckCircle2,
    },
    {
      title: 'Recovery queue',
      value: `${props.posture.recovery} need intervention`,
      detail: 'Failed or escalated steps that need recovery before flow resumes',
      icon: AlertTriangle,
    },
    {
      title: 'Orchestrator turns',
      value: `${props.posture.orchestrator} visible`,
      detail: 'Live orchestration turns mixed into the same filtered scope',
      icon: Bot,
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {packets.map((packet) => (
        <Card key={packet.title} className="border-border/70 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted">{packet.title}</CardTitle>
            <packet.icon className="h-4 w-4 text-muted" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{packet.value}</p>
            <p className="mt-2 text-xs leading-5 text-muted">{packet.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TaskMobileCard(props: { task: TaskListRecord }): JSX.Element {
  const status = resolveTaskStatus(props.task);
  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/10 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link to={`/work/tasks/${props.task.id}`} className="block truncate text-sm font-semibold text-accent hover:underline">
            {props.task.title ?? props.task.name ?? props.task.id}
          </Link>
          <p className="text-xs text-muted">{describeTaskNextAction(props.task)}</p>
        </div>
        <Badge variant={statusBadgeVariant(status)} className="capitalize">
          {status.replace(/_/g, ' ')}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{describeTaskKind(props.task)}</Badge>
        {props.task.role ? <Badge variant="outline">{props.task.role}</Badge> : null}
      </div>
      <div className="grid gap-2 text-sm">
        <TaskMetaRow label="Board" value={props.task.workflow_name ?? props.task.workflow_id ?? 'No workflow'} link={props.task.workflow_id ? `/work/workflows/${props.task.workflow_id}` : undefined} />
        <TaskMetaRow label="Scope" value={describeTaskScope(props.task)} />
        <TaskMetaRow label="Owner" value={props.task.agent_name ?? props.task.agent_id ?? props.task.assigned_worker ?? 'Unassigned'} />
        <TaskMetaRow label="Created" value={formatRelativeTime(props.task.created_at)} title={new Date(props.task.created_at).toLocaleString()} />
        <TaskMetaRow label="Duration" value={formatTaskDuration(props.task)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" asChild>
          <Link to={`/work/tasks/${props.task.id}`}>Open step</Link>
        </Button>
        {props.task.workflow_id ? (
          <Button size="sm" variant="outline" asChild>
            <Link to={`/work/workflows/${props.task.workflow_id}`}>Open board</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function TaskTableRow(props: { task: TaskListRecord }): JSX.Element {
  const status = resolveTaskStatus(props.task);
  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="space-y-2">
          <Link to={`/work/tasks/${props.task.id}`} className="text-sm font-semibold text-accent hover:underline">
            {props.task.title ?? props.task.name ?? props.task.id}
          </Link>
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusBadgeVariant(status)} className="capitalize">
              {status.replace(/_/g, ' ')}
            </Badge>
            <Badge variant="outline">{describeTaskKind(props.task)}</Badge>
            {props.task.role ? <Badge variant="outline">{props.task.role}</Badge> : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="align-top">
        <div className="space-y-1 text-sm">
          {props.task.workflow_id ? (
            <Link to={`/work/workflows/${props.task.workflow_id}`} className="font-medium text-accent hover:underline">
              {props.task.workflow_name ?? props.task.workflow_id}
            </Link>
          ) : (
            <p>No workflow linked</p>
          )}
          <p className="text-muted">{describeTaskScope(props.task)}</p>
        </div>
      </TableCell>
      <TableCell className="align-top text-sm">
        {describeTaskNextAction(props.task)}
      </TableCell>
      <TableCell className="align-top text-sm">
        {props.task.agent_name ?? props.task.agent_id ?? props.task.assigned_worker ?? 'Unassigned'}
      </TableCell>
      <TableCell className="align-top">
        <div className="space-y-1 text-sm">
          <p title={new Date(props.task.created_at).toLocaleString()}>
            {formatRelativeTime(props.task.created_at)}
          </p>
          <p className="text-muted">{formatTaskDuration(props.task)}</p>
        </div>
      </TableCell>
    </TableRow>
  );
}

function TaskMetaRow(props: {
  label: string;
  value: string;
  link?: string;
  title?: string;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted">{props.label}</span>
      {props.link ? (
        <Link to={props.link} className="max-w-[65%] truncate text-right font-medium text-accent hover:underline" title={props.title ?? props.value}>
          {props.value}
        </Link>
      ) : (
        <span className="max-w-[65%] text-right font-medium" title={props.title ?? props.value}>
          {props.value}
        </span>
      )}
    </div>
  );
}

function TaskListEmptyState(props: { hasFilters: boolean }): JSX.Element {
  return (
    <div className="grid gap-2 rounded-xl border border-dashed border-border/70 bg-muted/10 p-6 text-center">
      <p className="text-sm font-medium">
        {props.hasFilters ? 'No execution steps match the current filters.' : 'No execution steps yet.'}
      </p>
      <p className="text-sm text-muted">
        {props.hasFilters
          ? 'Adjust the search or status filter to bring the relevant board work back into view.'
          : 'Once orchestrators and specialists start work, this queue will surface the next action and recovery path here.'}
      </p>
    </div>
  );
}

function TaskPagination(props: {
  filteredCount: number;
  page: number;
  totalPages: number;
  onPrevious(): void;
  onNext(): void;
}): JSX.Element | null {
  if (props.filteredCount <= PAGE_SIZE) {
    return null;
  }
  return (
    <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted">
        Showing {props.page * PAGE_SIZE + 1}-{Math.min((props.page + 1) * PAGE_SIZE, props.filteredCount)} of{' '}
        {props.filteredCount} visible steps.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={props.page === 0} onClick={props.onPrevious}>
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={props.page >= props.totalPages - 1} onClick={props.onNext}>
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
