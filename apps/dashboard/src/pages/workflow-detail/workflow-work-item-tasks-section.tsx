import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { dashboardApi } from '../../lib/api.js';
import {
  CopyableIdBadge,
  OperatorStatusBadge,
} from '../../components/operator-display/operator-display.js';
import { Badge } from '../../components/ui/badge.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { buildTaskDetailHref } from '../work-shared/work-href-support.js';
import {
  describeTaskOperatorPosture,
  summarizeWorkItemExecution,
  sortTasksForOperatorReview,
  type DashboardWorkItemTaskRecord,
} from './workflow-work-item-detail-support.js';
import { WorkItemTaskActionCell } from './workflow-work-item-task-action-cell.js';

const mutedBodyClass = 'text-sm leading-6 text-muted';

export function WorkItemTasksSection(props: {
  workflowId: string;
  workItemId: string;
  tasks: DashboardWorkItemTaskRecord[];
  executionSummary: ReturnType<typeof summarizeWorkItemExecution>;
  isMilestone: boolean;
  childCount: number;
  onWorkItemChanged(): Promise<unknown> | unknown;
}): JSX.Element {
  const orderedTasks = useMemo(() => sortTasksForOperatorReview(props.tasks), [props.tasks]);
  const agentsQuery = useQuery({
    queryKey: ['workflow-work-item-agents', props.workflowId],
    queryFn: () => dashboardApi.listAgents(),
    staleTime: 60_000,
  });
  const attentionTasks = orderedTasks.filter(
    (task) =>
      task.state === 'awaiting_approval' ||
      task.state === 'output_pending_assessment' ||
      task.state === 'failed' ||
      task.state === 'escalated',
  );

  if (props.tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
        No execution steps are linked to this work item yet.
      </div>
    );
  }

  return (
    <section className="grid gap-4 rounded-xl border border-border/70 bg-surface p-4 shadow-sm">
      <TaskExecutionSummary
        executionSummary={props.executionSummary}
        attentionCount={attentionTasks.length}
      />
      {attentionTasks.length > 0 ? <AttentionTaskGrid tasks={attentionTasks} /> : null}
      <div className="grid gap-2">
        <strong className="text-base">Execution queue</strong>
        <p className={mutedBodyClass}>
          Steps are ordered by operator urgency so approvals, escalations, and retries appear before
          background progress updates.
        </p>
      </div>
      <p className={mutedBodyClass}>
        {props.isMilestone
          ? `Showing execution steps linked to this milestone and its ${props.childCount} child work items.`
          : 'Linked execution steps stay here so approvals, rework, and retries remain anchored to the selected work item.'}
      </p>
      <div className="grid gap-3 lg:hidden">
        {orderedTasks.map((task) => (
          <TaskExecutionCard
            key={task.id}
            workflowId={props.workflowId}
            workItemId={props.workItemId}
            task={task}
            agents={agentsQuery.data ?? []}
            isLoadingAgents={agentsQuery.isLoading}
            onWorkItemChanged={props.onWorkItemChanged}
          />
        ))}
      </div>
      <div className="hidden overflow-x-auto lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Step</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Dependencies</TableHead>
              <TableHead>Operator flow</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orderedTasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell>
                  <div className="grid gap-2">
                    <Link to={buildTaskDetailHref(task.id)}>{task.title}</Link>
                    <CopyableIdBadge value={task.id} label="Step" />
                  </div>
                </TableCell>
                <TableCell>
                  <OperatorStatusBadge status={task.state} />
                </TableCell>
                <TableCell>{task.role ?? 'Unassigned'}</TableCell>
                <TableCell>{task.stage_name ?? 'unassigned'}</TableCell>
                <TableCell>
                  {task.depends_on.length > 0 ? task.depends_on.join(', ') : '—'}
                </TableCell>
                <TableCell className="min-w-[18rem]">
                  <WorkItemTaskActionCell
                    workflowId={props.workflowId}
                    workItemId={props.workItemId}
                    task={task}
                    agents={agentsQuery.data ?? []}
                    isLoadingAgents={agentsQuery.isLoading}
                    onWorkItemChanged={props.onWorkItemChanged}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function TaskExecutionSummary(props: {
  executionSummary: ReturnType<typeof summarizeWorkItemExecution>;
  attentionCount: number;
}): JSX.Element {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DetailStatCard
          label="Linked steps"
          value={String(props.executionSummary.totalSteps)}
          detail="Execution records anchored here"
        />
        <DetailStatCard
          label="Needs decision"
          value={String(props.executionSummary.awaitingOperator)}
          detail="Operator decisions still needed"
        />
        <DetailStatCard
          label="Retryable"
          value={String(props.executionSummary.retryableSteps)}
          detail="Failed or escalated steps"
        />
        <DetailStatCard
          label="In flight"
          value={String(props.executionSummary.activeSteps)}
          detail="Ready, blocked, or in progress"
        />
      </div>
      <div className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-sm">Execution decision packet</strong>
          <Badge variant="outline">{props.executionSummary.completedSteps} completed</Badge>
        </div>
        <p className={mutedBodyClass}>
          Roles and stage coverage stay visible here so operators can spot ownership gaps before
          opening individual step records.
        </p>
        <div className="grid gap-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Roles in play
          </div>
          <div className="flex flex-wrap gap-2">
            {props.executionSummary.distinctRoles.length > 0 ? (
              props.executionSummary.distinctRoles.map((role) => (
                <Badge key={role} variant="outline">
                  {role}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted">No roles assigned yet.</span>
            )}
          </div>
        </div>
        <div className="grid gap-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Stage coverage
          </div>
          <div className="flex flex-wrap gap-2">
            {props.executionSummary.distinctStages.length > 0 ? (
              props.executionSummary.distinctStages.map((stageName) => (
                <Badge key={stageName} variant="outline">
                  {stageName}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted">No stages assigned yet.</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={props.attentionCount > 0 ? 'warning' : 'outline'}>
            {props.attentionCount} queued for decision
          </Badge>
        </div>
      </div>
    </div>
  );
}

function AttentionTaskGrid(props: { tasks: DashboardWorkItemTaskRecord[] }): JSX.Element {
  return (
    <div className="grid gap-3 rounded-xl border border-amber-300/70 bg-amber-50/80 p-4 dark:border-amber-900/70 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <strong className="text-base">Requires operator attention</strong>
          <p className={mutedBodyClass}>
            The highest-urgency steps are pinned here first so approvals and retries do not get
            buried below routine execution.
          </p>
        </div>
        <Badge variant="warning">{props.tasks.length} queued for decision</Badge>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {props.tasks.slice(0, 4).map((task) => {
          const posture = describeTaskOperatorPosture(task);
          return (
            <article
              key={`attention:${task.id}`}
              className="grid gap-2 rounded-xl border border-border/70 bg-background/90 p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-2">
                  <Link to={buildTaskDetailHref(task.id)} className="font-medium text-foreground">
                    {task.title}
                  </Link>
                  <CopyableIdBadge value={task.id} label="Step" />
                </div>
                <OperatorStatusBadge status={task.state} />
              </div>
              <p className={mutedBodyClass}>{posture.detail}</p>
              <div className="flex flex-wrap gap-2">
                {task.role ? <Badge variant="outline">{task.role}</Badge> : null}
                {task.stage_name ? <Badge variant="outline">{task.stage_name}</Badge> : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function TaskExecutionCard(props: {
  workflowId: string;
  workItemId: string;
  task: DashboardWorkItemTaskRecord;
  agents: Parameters<typeof WorkItemTaskActionCell>[0]['agents'];
  isLoadingAgents: boolean;
  onWorkItemChanged(): Promise<unknown> | unknown;
}): JSX.Element {
  return (
    <article className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-2">
          <div className="grid gap-2">
            <Link
              to={buildTaskDetailHref(props.task.id)}
              className="text-base font-semibold text-foreground"
            >
              {props.task.title}
            </Link>
            <CopyableIdBadge value={props.task.id} label="Step" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OperatorStatusBadge status={props.task.state} />
            <Badge variant="outline">{props.task.role ?? 'Unassigned'}</Badge>
            <Badge variant="outline">{props.task.stage_name ?? 'unassigned'}</Badge>
          </div>
        </div>
        <TaskDependencySummary task={props.task} />
      </div>
      <WorkItemTaskActionCell
        workflowId={props.workflowId}
        workItemId={props.workItemId}
        task={props.task}
        agents={props.agents}
        isLoadingAgents={props.isLoadingAgents}
        onWorkItemChanged={props.onWorkItemChanged}
      />
    </article>
  );
}

function TaskDependencySummary(props: { task: DashboardWorkItemTaskRecord }): JSX.Element {
  if (props.task.depends_on.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-xs text-muted">
        No dependencies
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-lg border border-border/70 bg-background/80 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        Dependencies
      </div>
      <div className="flex flex-wrap gap-2">
        {props.task.depends_on.map((dependency) => (
          <Badge key={dependency} variant="outline">
            {dependency}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function DetailStatCard(props: { label: string; value: string; detail: string }): JSX.Element {
  return (
    <div className="grid gap-1 rounded-xl border border-border/70 bg-background/80 p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        {props.label}
      </div>
      <div className="text-sm font-semibold text-foreground">{props.value}</div>
      <div className="text-xs leading-5 text-muted">{props.detail}</div>
    </div>
  );
}
