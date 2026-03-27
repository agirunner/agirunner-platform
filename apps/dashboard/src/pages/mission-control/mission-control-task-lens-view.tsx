import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  describeTaskKind,
  describeTaskNextAction,
  describeTaskScope,
  formatRelativeTime,
  formatStatusLabel,
  normalizeTaskStatus,
  statusBadgeVariant,
  type TaskListRecord,
} from '../task-list/task-list-page.support.js';
import { buildWorkflowOperatorPermalink } from '../work-shared/task-operator-flow.js';

export function MissionControlTaskLensView(props: {
  mode: 'live' | 'recent' | 'history';
  tasks: TaskListRecord[];
  isLoading: boolean;
}): JSX.Element {
  const tasks = selectTaskLensTasks(props.tasks, props.mode);

  if (props.isLoading && tasks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading task lens</CardTitle>
          <CardDescription>Collecting tenant-wide step activity for the current Mission Control mode.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{readModeTitle(props.mode)}</CardTitle>
          <CardDescription>{readModeDescription(props.mode)}</CardDescription>
        </CardHeader>
      </Card>

      {tasks.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No task activity</CardTitle>
            <CardDescription>No workflow-linked specialist or orchestrator steps match this lens right now.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        tasks.map((task) => (
          <TaskLensCard key={task.id} task={task} />
        ))
      )}
    </div>
  );
}

function TaskLensCard(props: { task: TaskListRecord }): JSX.Element {
  const task = props.task;
  const status = normalizeTaskStatus(task.state ?? task.status);
  const workflowHref = buildWorkflowOperatorPermalink(task);
  const title = task.title ?? task.name ?? task.id;

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>
              {[task.workflow_name, describeTaskKind(task)].filter(Boolean).join(' • ') || 'Workflow task'}
            </CardDescription>
          </div>
          <Badge variant={statusBadgeVariant(status)}>{formatStatusLabel(status)}</Badge>
        </div>
        <p className="text-sm text-foreground">{describeTaskNextAction(task)}</p>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/10 p-3 text-xs sm:grid-cols-2">
          <TaskFact label="Scope" value={describeTaskScope(task)} />
          <TaskFact label="Last updated" value={readTaskTimestamp(task)} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{task.role ?? 'Unassigned role'}</span>
          {workflowHref ? (
            <Link className="text-sm font-medium text-accent hover:underline" to={workflowHref}>
              Open workflow context
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function TaskFact(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{props.label}</p>
      <p className="text-sm text-foreground">{props.value}</p>
    </div>
  );
}

function selectTaskLensTasks(
  tasks: TaskListRecord[],
  mode: 'live' | 'recent' | 'history',
): TaskListRecord[] {
  const filtered = tasks.filter((task) => shouldIncludeTask(task, mode));
  return filtered.sort((left, right) => readSortTimestamp(right) - readSortTimestamp(left)).slice(0, 24);
}

function shouldIncludeTask(
  task: TaskListRecord,
  mode: 'live' | 'recent' | 'history',
): boolean {
  const status = normalizeTaskStatus(task.state ?? task.status);
  if (mode === 'live') {
    return ['ready', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'failed', 'escalated'].includes(status);
  }
  if (mode === 'recent') {
    return ['completed', 'failed', 'awaiting_approval', 'output_pending_assessment', 'escalated'].includes(status);
  }
  return true;
}

function readSortTimestamp(task: TaskListRecord): number {
  return new Date(task.completed_at ?? task.started_at ?? task.created_at).getTime();
}

function readTaskTimestamp(task: TaskListRecord): string {
  return formatRelativeTime(task.completed_at ?? task.started_at ?? task.created_at);
}

function readModeTitle(mode: 'live' | 'recent' | 'history'): string {
  switch (mode) {
    case 'recent':
      return 'Recent task lens';
    case 'history':
      return 'Task history lens';
    default:
      return 'Live task lens';
  }
}

function readModeDescription(mode: 'live' | 'recent' | 'history'): string {
  switch (mode) {
    case 'recent':
      return 'Recent mode shifts from workflow packets into the latest workflow-linked step outcomes and decisions.';
    case 'history':
      return 'History lens keeps the tenant-wide task trail visible without falling back to the standalone task page.';
    default:
      return 'Live mode shifts from workflow posture into the operator-facing step queue while keeping workflow context one click away.';
  }
}
