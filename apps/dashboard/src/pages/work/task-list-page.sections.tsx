import { AlertTriangle, Bot, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { SavedViews, type SavedViewFilters } from '../../components/saved-views.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  STATUS_FILTERS,
  TASK_LIST_PAGE_SIZE,
  formatStatusLabel,
  summarizeTaskPosture,
  type StatusFilter,
  type TaskListRecord,
} from './task-list-page.support.js';
import { TaskMobileCard, TaskTableRows } from './task-list-page.rows.js';

export function TaskListFilters(props: {
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

export function TaskPostureSection(props: {
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

export function TaskListContent(props: {
  tasks: TaskListRecord[];
  filteredCount: number;
  page: number;
  totalPages: number;
  hasFilters: boolean;
  onPrevious(): void;
  onNext(): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-2">
        <CardTitle>Visible execution steps</CardTitle>
        <p className="text-sm text-muted">
          Every row or card leads with current posture, board context, and recovery path instead
          of a raw task dump.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.tasks.length === 0 ? (
          <TaskListEmptyState hasFilters={props.hasFilters} />
        ) : (
          <>
            <div className="grid gap-3 lg:hidden">
              {props.tasks.map((task) => (
                <TaskMobileCard key={task.id} task={task} />
              ))}
            </div>
            <TaskTableRows tasks={props.tasks} />
          </>
        )}
        <TaskPagination
          filteredCount={props.filteredCount}
          page={props.page}
          totalPages={props.totalPages}
          onPrevious={props.onPrevious}
          onNext={props.onNext}
        />
      </CardContent>
    </Card>
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
  if (props.filteredCount <= TASK_LIST_PAGE_SIZE) {
    return null;
  }
  return (
    <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted">
        Showing {props.page * TASK_LIST_PAGE_SIZE + 1}-
        {Math.min((props.page + 1) * TASK_LIST_PAGE_SIZE, props.filteredCount)} of{' '}
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
