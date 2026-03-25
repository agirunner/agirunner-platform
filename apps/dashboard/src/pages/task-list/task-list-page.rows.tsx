import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import {
  describeExecutionBackend,
  describeExecutionSurfaceLabel,
  describeSandboxUsage,
  describeTaskKind,
  describeTaskNextAction,
  describeTaskScope,
  formatRelativeTime,
  formatTaskDuration,
  resolveTaskStatus,
  statusBadgeVariant,
  type TaskListRecord,
} from './task-list-page.support.js';
import {
  buildTaskDiagnosticAction,
  buildTaskPrimaryOperatorAction,
} from './task-list-page.actions.js';

export function TaskMobileCard(props: { task: TaskListRecord }): JSX.Element {
  const status = resolveTaskStatus(props.task);
  const primaryAction = buildTaskPrimaryOperatorAction(props.task);
  const diagnosticAction = buildTaskDiagnosticAction(props.task);
  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/10 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link to={primaryAction.href} className="block truncate text-sm font-semibold text-accent hover:underline">
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
        <Badge variant="outline">{describeExecutionBackend(props.task)}</Badge>
        {!props.task.is_orchestrator_task ? (
          <Badge variant="secondary">{describeSandboxUsage(props.task)}</Badge>
        ) : null}
        {props.task.role ? <Badge variant="outline">{props.task.role}</Badge> : null}
      </div>
      <div className="grid gap-2 text-sm">
        <TaskMetaRow
          label="Board"
          value={props.task.workflow_name ?? props.task.workflow_id ?? 'No workflow'}
          link={props.task.workflow_id ? `/mission-control/workflows/${props.task.workflow_id}` : undefined}
        />
        <TaskMetaRow label="Scope" value={describeTaskScope(props.task)} />
        <TaskMetaRow label="Execution backend" value={describeExecutionBackend(props.task)} />
        <TaskMetaRow label={describeExecutionSurfaceLabel(props.task)} value={describeSandboxUsage(props.task)} />
        <TaskMetaRow
          label="Owner"
          value={props.task.agent_name ?? props.task.agent_id ?? props.task.assigned_worker ?? 'Unassigned'}
        />
        <TaskMetaRow
          label="Created"
          value={formatRelativeTime(props.task.created_at)}
          title={new Date(props.task.created_at).toLocaleString()}
        />
        <TaskMetaRow label="Duration" value={formatTaskDuration(props.task)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" asChild>
          <Link to={primaryAction.href}>{primaryAction.label}</Link>
        </Button>
        {diagnosticAction ? (
          <Button size="sm" variant="outline" asChild>
            <Link to={diagnosticAction.href}>{diagnosticAction.label}</Link>
          </Button>
        ) : null}
        {props.task.workflow_id ? (
          <Button size="sm" variant="outline" asChild>
            <Link to={`/mission-control/workflows/${props.task.workflow_id}`}>Open board</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function TaskTableRows(props: { tasks: TaskListRecord[] }): JSX.Element {
  return (
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
          {props.tasks.map((task) => (
            <TaskTableRow key={task.id} task={task} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TaskTableRow(props: { task: TaskListRecord }): JSX.Element {
  const status = resolveTaskStatus(props.task);
  const primaryAction = buildTaskPrimaryOperatorAction(props.task);
  const diagnosticAction = buildTaskDiagnosticAction(props.task);
  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="space-y-2">
          <Link to={primaryAction.href} className="text-sm font-semibold text-accent hover:underline">
            {props.task.title ?? props.task.name ?? props.task.id}
          </Link>
          <p className="text-xs leading-5 text-muted">{primaryAction.helper}</p>
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusBadgeVariant(status)} className="capitalize">
              {status.replace(/_/g, ' ')}
            </Badge>
            <Badge variant="outline">{describeTaskKind(props.task)}</Badge>
            <Badge variant="outline">{describeExecutionBackend(props.task)}</Badge>
            {!props.task.is_orchestrator_task ? (
              <Badge variant="secondary">{describeSandboxUsage(props.task)}</Badge>
            ) : null}
            {props.task.role ? <Badge variant="outline">{props.task.role}</Badge> : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="align-top">
        <div className="space-y-1 text-sm">
          {props.task.workflow_id ? (
            <Link
              to={`/mission-control/workflows/${props.task.workflow_id}`}
              className="font-medium text-accent hover:underline"
            >
              {props.task.workflow_name ?? props.task.workflow_id}
            </Link>
          ) : (
            <p>No workflow linked</p>
          )}
          <p className="text-muted">{describeTaskScope(props.task)}</p>
          <p className="text-muted">{describeExecutionBackend(props.task)}</p>
        </div>
      </TableCell>
      <TableCell className="align-top text-sm">
        {describeTaskNextAction(props.task)}
      </TableCell>
      <TableCell className="align-top text-sm">
        {props.task.agent_name ?? props.task.agent_id ?? props.task.assigned_worker ?? 'Unassigned'}
      </TableCell>
      <TableCell className="align-top">
        <div className="space-y-2 text-sm">
          <p title={new Date(props.task.created_at).toLocaleString()}>
            {formatRelativeTime(props.task.created_at)}
          </p>
          <p className="text-muted">{formatTaskDuration(props.task)}</p>
          {diagnosticAction ? (
            <Link to={diagnosticAction.href} className="text-xs font-medium text-accent hover:underline">
              {diagnosticAction.label}
            </Link>
          ) : null}
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
