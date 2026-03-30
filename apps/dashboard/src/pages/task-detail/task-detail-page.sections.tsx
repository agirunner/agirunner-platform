import type { ElementType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Cpu, DollarSign, User, Workflow } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  buildWorkflowDetailPermalink,
} from '../workflow-detail/workflow-detail-permalinks.js';
import {
  buildTaskNextStep,
  readAssessmentSignals,
  readReworkDetails,
} from './task-detail-support.js';
import {
  describeExecutionBackend,
  describeExecutionEnvironmentPackageManager,
  describeExecutionSurface,
  describeTaskKind,
  describeTaskSandboxUsage,
  formatDuration,
  formatRelativeTime,
  formatStatusLabel,
  formatTimestamp,
  renderExecutionEnvironmentValue,
  renderTimestamp,
  statusBadgeVariant,
  summarizeId,
  type Task,
} from './task-detail-page.model.js';
import { TaskActionButtons } from './task-detail-page.actions.js';
import {
  buildWorkflowOperatorPermalink,
  usesWorkItemOperatorFlow,
  usesWorkflowOperatorFlow,
} from '../work-shared/task-operator-flow.js';
import { describeAgentSurface } from '../../lib/operator-surfaces.js';

export function OperatorBriefingCard({ task, status }: { task: Task; status: string }): JSX.Element {
  const nextStep = buildTaskNextStep(task as never);
  const assessmentSignals = readAssessmentSignals(task as never);
  const reworkDetails = readReworkDetails(task as never);
  const workItemFlow = usesWorkItemOperatorFlow(task);
  const workflowLinkedStep = usesWorkflowOperatorFlow(task) || Boolean(task.workflow_id);

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusBadgeVariant(status)} className="capitalize">
                {formatStatusLabel(status)}
              </Badge>
              <Badge variant="outline">{describeTaskKind(task)}</Badge>
              {task.stage_name ? <Badge variant="secondary">Stage {task.stage_name}</Badge> : null}
              {task.role ? <Badge variant="outline">Role {task.role}</Badge> : null}
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                {task.title ?? task.name ?? task.id}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-muted">
                {task.description ?? nextStep.detail}
              </p>
            </div>
            <RelatedLinks task={task} />
          </div>
          <TaskActionButtons task={task} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="rounded-xl bg-border/10 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Recommended next move
          </p>
          <h2 className="mt-2 text-lg font-semibold">{nextStep.title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{nextStep.detail}</p>
          {workflowLinkedStep ? (
            <p className="mt-3 text-sm text-muted">
              {workItemFlow
                ? 'This specialist step belongs to a workflow work item. Run approval, rework, and retry decisions from the work-item flow so stage state, linked steps, and board context stay aligned.'
                : 'This specialist step is attached to a workflow stage without a linked work item yet. Use the workflow operator flow so board context stays aligned before mutating the step directly.'}
            </p>
          ) : null}
        </section>
        <section className="grid gap-3 rounded-xl bg-surface p-4 shadow-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Operator signals</p>
          </div>
          <SignalRow
            label="Assessment status"
            value={
              assessmentSignals.assessmentAction
                ? formatStatusLabel(assessmentSignals.assessmentAction)
                : 'No assessment action recorded'
            }
          />
          <SignalRow
            label="Rework rounds"
            value={reworkDetails.reworkCount > 0 ? String(reworkDetails.reworkCount) : 'No rework yet'}
          />
          <SignalRow
            label="Escalation target"
            value={assessmentSignals.escalationTarget ?? 'No escalation target'}
          />
          <SignalRow
            label="Clarification"
            value={
              reworkDetails.clarificationRequested
                ? 'Clarification requested'
                : 'No clarification request recorded'
            }
          />
          {assessmentSignals.assessmentFeedback ? (
            <div className="rounded-lg bg-border/10 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Latest assessment feedback
              </p>
              <p className="mt-2 text-sm leading-6">{assessmentSignals.assessmentFeedback}</p>
              {assessmentSignals.assessmentUpdatedAt ? (
                <p
                  className="mt-2 text-xs text-muted"
                  title={formatTimestamp(assessmentSignals.assessmentUpdatedAt)}
                >
                  Updated {formatRelativeTime(assessmentSignals.assessmentUpdatedAt)}
                </p>
              ) : null}
            </div>
          ) : null}
          {assessmentSignals.escalationAwaitingHuman ? (
            <div className="rounded-lg bg-border/10 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Escalation state
              </p>
              <p className="mt-2 text-sm leading-6">
                Waiting on a human response before the task can continue.
              </p>
            </div>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}

export function TaskMetadataGrid({ task }: { task: Task }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      <InfoCard
        icon={User}
        label={describeExecutionSurface(task)}
        value={task.agent_name ?? task.agent_id ?? 'Unassigned'}
      />
      <InfoCard
        icon={Cpu}
        label={describeAgentSurface(task)}
        value={task.assigned_worker ?? task.worker_id ?? 'Unassigned'}
      />
      <InfoCard icon={Workflow} label="Board" value={task.workflow_name ?? task.workflow_id ?? '-'} />
      <InfoCard icon={Workflow} label="Stage" value={task.stage_name ?? '-'} />
      <InfoCard
        icon={Workflow}
        label="Work Item"
        value={
          <span title={task.work_item_id ?? undefined} className="font-mono text-xs">
            {summarizeId(task.work_item_id)}
          </span>
        }
      />
      <InfoCard
        icon={Workflow}
        label="Activation"
        value={
          <span title={task.activation_id ?? undefined} className="font-mono text-xs">
            {summarizeId(task.activation_id)}
          </span>
        }
      />
      <InfoCard icon={Cpu} label="Execution backend" value={describeExecutionBackend(task)} />
      <InfoCard
        icon={Cpu}
        label={describeExecutionSurface(task)}
        value={describeTaskSandboxUsage(task)}
      />
      <InfoCard
        icon={Cpu}
        label="Execution environment"
        value={renderExecutionEnvironmentValue(task)}
      />
      <InfoCard
        icon={Cpu}
        label="Package manager"
        value={describeExecutionEnvironmentPackageManager(task)}
      />
      <InfoCard icon={User} label="Role" value={task.role ?? '-'} />
      <InfoCard icon={Clock} label="Created" value={renderTimestamp(task.created_at)} />
      <InfoCard icon={Clock} label="Started" value={renderTimestamp(task.started_at)} />
      <InfoCard icon={Clock} label="Completed" value={renderTimestamp(task.completed_at)} />
      <InfoCard icon={Clock} label="Duration" value={formatDuration(task)} />
      <InfoCard
        icon={DollarSign}
        label="Cost"
        value={task.cost !== undefined && task.cost !== null ? `$${task.cost.toFixed(2)}` : '-'}
      />
    </div>
  );
}

function InfoCard(props: {
  icon: ElementType;
  label: string;
  value: ReactNode;
}): JSX.Element {
  const Icon = props.icon;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Icon className="h-4 w-4" />
          {props.label}
        </div>
        <p className="mt-1 text-sm font-medium">{props.value}</p>
      </CardContent>
    </Card>
  );
}

function RelatedLinks({ task }: { task: Task }): JSX.Element {
  const workItemPermalink =
    task.workflow_id && task.work_item_id
      ? buildWorkflowDetailPermalink(task.workflow_id, { workItemId: task.work_item_id })
      : null;
  const workflowOperatorPermalink = buildWorkflowOperatorPermalink(task);

  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {task.workflow_id ? (
        <Link to={buildWorkflowDetailPermalink(task.workflow_id, {})} className="text-accent hover:underline">
          Open board
        </Link>
      ) : null}
      {workItemPermalink ? (
        <Link to={workItemPermalink} className="text-accent hover:underline">
          Open work item flow
        </Link>
      ) : null}
      {task.activation_id && task.workflow_id ? (
        <Link
          to={buildWorkflowDetailPermalink(task.workflow_id, { activationId: task.activation_id })}
          className="text-accent hover:underline"
        >
          Open activation
        </Link>
      ) : null}
      {workflowOperatorPermalink ? (
        <Link to={workflowOperatorPermalink} className="text-accent hover:underline">
          Open Workflow Operator Flow
        </Link>
      ) : null}
    </div>
  );
}

function SignalRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
