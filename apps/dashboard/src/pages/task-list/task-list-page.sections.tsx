import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
} from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { SavedViews, type SavedViewFilters } from '../../components/saved-views/saved-views.js';
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
  readTaskRecoveryCue,
  resolveTaskStatus,
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
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">Filter the execution queue</p>
              <Badge variant="outline">
                {props.filteredCount} visible step{props.filteredCount === 1 ? '' : 's'}
              </Badge>
            </div>
            <p className="text-sm leading-6 text-muted">
              Narrow the queue by posture or search term, then keep review and recovery work in the
              linked board flow instead of hopping between raw step records.
            </p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-muted/10 p-4">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              Active view
            </div>
            <p className="mt-2 text-sm font-medium">
              {props.searchQuery
                ? `Search: ${props.searchQuery}`
                : formatStatusLabel(props.statusFilter)}
            </p>
            <p className="mt-2 text-sm text-muted">
              Saved views keep the same queue slice ready for future recovery or approval passes.
            </p>
          </div>
        </div>
        <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)_auto]">
          <Select
            value={props.statusFilter}
            onValueChange={(value) => props.onStatusChange(value as StatusFilter)}
          >
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
            currentFilters={
              { status: props.statusFilter, search: props.searchQuery } as SavedViewFilters
            }
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
      title: 'Assessment queue',
      value: `${props.posture.assessment} waiting`,
      detail: 'Approvals and output assessments that need an operator decision',
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
        <Card key={packet.title} className="border-border/70 bg-card/90 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
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

export function TaskListOperatorCue(props: {
  tasks: TaskListRecord[];
  hasFilters: boolean;
}): JSX.Element {
  const posture = summarizeTaskPosture(props.tasks);
  const highlightedTask =
    props.tasks.find((task) => ['failed', 'escalated'].includes(resolveTaskStatus(task))) ??
    props.tasks.find((task) =>
      ['awaiting_approval', 'output_pending_assessment'].includes(resolveTaskStatus(task)),
    ) ??
    props.tasks.find((task) => resolveTaskStatus(task) === 'ready') ??
    props.tasks.find((task) => task.is_orchestrator_task) ??
    props.tasks[0];
  const assessmentPressure = posture.assessment > 0;
  const recoveryPressure = posture.recovery > 0;
  const cueTitle = recoveryPressure ? 'Recovery cue' : assessmentPressure ? 'Assessment cue' : 'Flow cue';
  const cueBody = readTaskRecoveryCue(highlightedTask);
  const cueFootnote = recoveryPressure
    ? `${posture.recovery} step${posture.recovery === 1 ? '' : 's'} still need intervention before lower-risk execution work matters.`
    : assessmentPressure
      ? `${posture.assessment} step${posture.assessment === 1 ? '' : 's'} are waiting on assessment, so operator decisions will unblock flow fastest.`
      : 'The current page is mostly execution and orchestration work, so use the linked board flow only when you need deeper context.';
  const filterBody = props.hasFilters
    ? 'A saved or ad-hoc filter is active, so counts and cues reflect only the current slice.'
    : 'No extra filters are active, so the cues reflect the full visible operator queue.';

  return (
    <Card className="border-border/70 bg-muted/10 shadow-sm">
      <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.8fr)]">
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {cueTitle}
          </div>
          <p className="text-base font-semibold">Clear assessments, then recover</p>
          <p className="text-sm leading-6 text-muted">{cueBody}</p>
          <p className="text-xs leading-5 text-muted">{cueFootnote}</p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Queue focus
          </div>
          <p className="mt-2 text-sm text-muted">{filterBody}</p>
        </div>
      </CardContent>
    </Card>
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
          This page keeps posture, recovery cues, board context, and the correct operator flow in
          view instead of falling back to a raw step dump. Execution backend and task sandbox usage
          stay visible so operators can tell whether a step stayed runtime-only or touched a task
          sandbox.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.tasks.length === 0 ? (
          <TaskListEmptyState hasFilters={props.hasFilters} />
        ) : (
          <>
            <TaskListOperatorCue tasks={props.tasks} hasFilters={props.hasFilters} />
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
        {props.hasFilters
          ? 'No execution steps match the current filters.'
          : 'No execution steps yet.'}
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
        <Button
          variant="outline"
          size="sm"
          disabled={props.page >= props.totalPages - 1}
          onClick={props.onNext}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
