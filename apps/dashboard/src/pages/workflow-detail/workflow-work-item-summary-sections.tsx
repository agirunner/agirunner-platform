import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  CopyableIdBadge,
  OperatorStatusBadge,
} from '../../components/operator-display/operator-display.js';
import { cn } from '../../lib/utils.js';
import type { DashboardWorkflowStageRecord } from '../../lib/api.js';
import {
  describeCountLabel,
  isMilestoneWorkItem,
  summarizeWorkItemExecution,
  type DashboardGroupedWorkItemRecord,
} from './workflow-work-item-detail-support.js';

const metaRowClass = 'flex flex-wrap items-center gap-2';
const mutedBodyClass = 'text-sm leading-6 text-muted';

export function WorkItemHeader(props: {
  workItem: DashboardGroupedWorkItemRecord;
  breadcrumbs: string[];
  childCount: number;
  linkedTaskCount: number;
  artifactCount: number;
  stages: DashboardWorkflowStageRecord[];
  onSelectWorkItem(workItemId: string): void;
}): JSX.Element {
  const { workItem } = props;
  const milestone = isMilestoneWorkItem(workItem);
  const completedChildren =
    workItem.children_completed ??
    workItem.children?.filter((child) => child.completed_at).length ??
    0;
  const stageRecord = props.stages.find((stage) => stage.name === workItem.stage_name) ?? null;

  return (
    <section className="grid gap-4 rounded-xl border border-border/70 bg-gradient-to-br from-border/10 via-surface to-surface p-4 shadow-sm">
      <div className={metaRowClass}>
        <Badge variant="outline">Operator breadcrumb</Badge>
        <CopyableIdBadge value={workItem.id} label="Work item" />
        <span className="text-sm text-muted">
          {(props.breadcrumbs.length > 0 ? props.breadcrumbs : [workItem.title]).join(' / ')}
          {workItem.stage_name ? ` / ${workItem.stage_name}` : ''}
        </span>
      </div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="grid gap-2">
          <strong className="text-xl leading-tight">{workItem.title}</strong>
          {workItem.goal ? <p className={mutedBodyClass}>{workItem.goal}</p> : null}
        </div>
        <div className={cn(metaRowClass, 'xl:max-w-[45%] xl:justify-end')}>
          <Badge variant="outline">{workItem.stage_name ?? 'Unassigned stage'}</Badge>
          <Badge variant="outline">{workItem.priority ?? 'normal'}</Badge>
          <Badge variant="outline">{workItem.column_id ?? 'Unassigned column'}</Badge>
          {stageRecord && stageRecord.iteration_count > 0 ? (
            <Badge variant="warning">
              {stageRecord.iteration_count} stage iteration
              {stageRecord.iteration_count === 1 ? '' : 's'}
            </Badge>
          ) : null}
          {milestone ? <Badge variant="outline">Milestone</Badge> : null}
          {milestone ? (
            <Badge variant="outline">
              {completedChildren}/{props.childCount} children complete
            </Badge>
          ) : null}
          <OperatorStatusBadge status={workItem.completed_at ? 'completed' : 'active'} />
        </div>
      </div>
      <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          Current routing
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{workItem.stage_name ?? 'Unassigned stage'}</Badge>
          <Badge variant="outline">{workItem.column_id ?? 'Unassigned column'}</Badge>
          <Badge variant="outline">
            {describeCountLabel(props.linkedTaskCount, 'linked step')}
          </Badge>
          <Badge variant="outline">{describeCountLabel(props.artifactCount, 'artifact')}</Badge>
          {workItem.owner_role ? <Badge variant="outline">{workItem.owner_role}</Badge> : null}
          {typeof workItem.rework_count === 'number' && workItem.rework_count > 0 ? (
            <Badge variant="warning">
              {workItem.rework_count} rework loop{workItem.rework_count === 1 ? '' : 's'}
            </Badge>
          ) : null}
        </div>
        <p className={mutedBodyClass}>
          {milestone
            ? `This milestone coordinates ${props.childCount} child work item${props.childCount === 1 ? '' : 's'} across the board.`
            : 'Review the summary first. Open controls only when routing or metadata needs to change.'}
        </p>
        {readContinuitySummary(workItem) ? (
          <div className="rounded-lg border border-border/70 bg-muted/10 px-3 py-2 text-sm text-muted">
            <span className="font-medium text-foreground">Operator next step:</span>{' '}
            {readContinuitySummary(workItem)}
          </div>
        ) : null}
      </div>
      {stageRecord ? <WorkItemStageProgressCard stage={stageRecord} /> : null}
      <div className={metaRowClass}>
        {workItem.task_count !== undefined ? (
          <Badge variant="outline">{describeCountLabel(workItem.task_count, 'linked step')}</Badge>
        ) : null}
        {workItem.parent_work_item_id ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => props.onSelectWorkItem(workItem.parent_work_item_id as string)}
          >
            Open parent milestone
          </Button>
        ) : null}
      </div>
      {workItem.acceptance_criteria ? (
        <div className="rounded-xl border border-border/70 bg-border/10 p-4 text-sm">
          <strong>Acceptance criteria</strong>
          <p className="mt-2 text-sm leading-6 text-muted">{workItem.acceptance_criteria}</p>
        </div>
      ) : null}
      {workItem.notes ? (
        <div className="rounded-xl border border-border/70 bg-border/10 p-4 text-sm">
          <strong>Notes</strong>
          <p className="mt-2 text-sm leading-6 text-muted">{workItem.notes}</p>
        </div>
      ) : null}
    </section>
  );
}

export function MilestoneOperatorSummarySection(props: {
  summary: {
    totalChildren: number;
    completedChildren: number;
    openChildren: number;
    awaitingStepDecisions: number;
    failedSteps: number;
    inFlightSteps: number;
    activeStageNames: string[];
    activeColumnIds: string[];
  };
}): JSX.Element {
  return (
    <section className="grid gap-4 md:grid-cols-3" data-testid="milestone-operator-summary">
      <article className="rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Milestone group summary
        </div>
        <div className={metaRowClass}>
          <Badge variant="outline">
            {describeCountLabel(props.summary.totalChildren, 'child item')}
          </Badge>
          <Badge variant="outline">{props.summary.completedChildren} complete</Badge>
          <Badge variant="outline">{props.summary.openChildren} open</Badge>
        </div>
      </article>
      <article className="rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Operator attention
        </div>
        <div className={metaRowClass}>
          <Badge variant="warning">
            {describeCountLabel(props.summary.awaitingStepDecisions, 'step decision')}
          </Badge>
          <Badge variant="destructive">
            {describeCountLabel(props.summary.failedSteps, 'failed step')}
          </Badge>
          <Badge variant="outline">{props.summary.inFlightSteps} in flight</Badge>
        </div>
      </article>
      <article className="rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Active footprint
        </div>
        <div className={metaRowClass}>
          <Badge variant="outline">
            {props.summary.activeStageNames.length} live stage
            {props.summary.activeStageNames.length === 1 ? '' : 's'}
          </Badge>
          <Badge variant="outline">
            {props.summary.activeColumnIds.length} board column
            {props.summary.activeColumnIds.length === 1 ? '' : 's'}
          </Badge>
        </div>
      </article>
    </section>
  );
}

export function WorkItemFocusPacket(props: {
  executionSummary: ReturnType<typeof summarizeWorkItemExecution>;
  artifactCount: number;
  memoryCount: number;
  eventCount: number;
}): JSX.Element {
  const nextMove =
    props.executionSummary.awaitingOperator > 0
      ? 'Open evidence first to clear approvals, requested changes, or escalations before editing board routing.'
      : props.executionSummary.retryableSteps > 0
        ? 'Review evidence for retryable or escalated steps, then return to operator controls for any routing changes.'
        : 'Use operator controls only if the work item needs rerouting or a metadata update. Otherwise stay in the summary packet and keep triage moving.';

  return (
    <section className="grid gap-4 rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm">
      <div className="grid gap-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          Operator snapshot
        </div>
        <strong className="text-base text-foreground">What needs attention next</strong>
        <p className={mutedBodyClass}>{nextMove}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant={props.executionSummary.awaitingOperator > 0 ? 'warning' : 'outline'}>
          {props.executionSummary.awaitingOperator} need decision
        </Badge>
        <Badge variant={props.executionSummary.retryableSteps > 0 ? 'warning' : 'outline'}>
          {props.executionSummary.retryableSteps} retryable
        </Badge>
        <Badge variant="outline">{props.memoryCount} memory packets</Badge>
        <Badge variant="outline">{props.artifactCount} artifacts</Badge>
        <Badge variant="outline">{props.eventCount} history events</Badge>
      </div>
    </section>
  );
}

export function WorkItemReviewClosure(props: {
  title: string;
  detail: string;
}): JSX.Element {
  return (
    <section className="grid gap-2 rounded-xl border border-dashed border-border/70 bg-background/80 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        Decision checkpoint
      </div>
      <strong className="text-sm text-foreground">{props.title}</strong>
      <p className={mutedBodyClass}>{props.detail}</p>
    </section>
  );
}

export function MilestoneChildrenSection(props: {
  children: DashboardGroupedWorkItemRecord[];
  onSelectWorkItem(workItemId: string): void;
}): JSX.Element {
  const groupedByStage = props.children.reduce<Record<string, DashboardGroupedWorkItemRecord[]>>(
    (acc, child) => {
      const key = child.stage_name ?? 'unassigned';
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(child);
      return acc;
    },
    {},
  );

  return (
    <section className="grid gap-4 rounded-xl border border-border/70 bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-base">Milestone children</strong>
        <Badge variant="outline">{describeCountLabel(props.children.length, 'item')}</Badge>
      </div>
      <p className={mutedBodyClass}>
        Child work items inherit this milestone’s operator context but can move independently across
        the board.
      </p>
      {props.children.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
          No child work items are linked to this milestone yet.
        </div>
      ) : (
        Object.entries(groupedByStage).map(([stageName, children]) => (
          <div key={stageName} className="grid gap-3">
            <div className={metaRowClass}>
              <Badge variant="outline">Stage group</Badge>
              <strong>{stageName}</strong>
              <span className="text-sm text-muted">
                {describeCountLabel(children.length, 'child item')}
              </span>
            </div>
            {children.map((child) => (
              <article
                key={child.id}
                className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto justify-start px-0 text-left text-base font-semibold"
                    onClick={() => props.onSelectWorkItem(child.id)}
                  >
                    {child.title}
                  </Button>
                  <div className={metaRowClass}>
                    <Badge variant="outline">{child.column_id}</Badge>
                    {child.completed_at ? <Badge variant="secondary">completed</Badge> : null}
                  </div>
                </div>
                <div className={metaRowClass}>
                  <Badge variant="outline">Open child work-item flow</Badge>
                </div>
                {child.goal ? <p className={mutedBodyClass}>{child.goal}</p> : null}
              </article>
            ))}
          </div>
        ))
      )}
    </section>
  );
}

function readContinuitySummary(workItem: DashboardGroupedWorkItemRecord): string | null {
  if (workItem.blocked_state === 'blocked') {
    return workItem.blocked_reason?.trim()
      ? `Blocked: ${workItem.blocked_reason.trim()}`
      : 'Blocked until the current operator or control-plane blocker is cleared.';
  }
  if (workItem.escalation_status === 'open') {
    return 'Escalation is open. Resolve it before routing successor work or completing this item.';
  }
  const nextActor = workItem.next_expected_actor?.trim();
  const nextAction = workItem.next_expected_action?.trim();
  if (nextActor && nextAction) {
    return `${nextActor} should ${nextAction}.`;
  }
  if (nextActor) {
    return `${nextActor} is the next expected actor.`;
  }
  if (nextAction) {
    return `Next expected action: ${nextAction}.`;
  }
  return null;
}

function WorkItemStageProgressCard(props: { stage: DashboardWorkflowStageRecord }): JSX.Element {
  const progressPercent = readStageProgressPercent(props.stage);
  const completedCount = Math.max(
    0,
    props.stage.total_work_item_count - props.stage.open_work_item_count,
  );

  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-background/70 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Stage progress
          </p>
          <p className="text-sm font-medium text-foreground">
            {completedCount} of {props.stage.total_work_item_count} work items complete in{' '}
            {props.stage.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {progressPercent === null ? 'No percent yet' : `${progressPercent}% complete`}
          </Badge>
          {props.stage.gate_status !== 'not_requested' ? (
            <Badge
              variant={
                props.stage.gate_status === 'approved'
                  ? 'success'
                  : props.stage.gate_status === 'requested' ||
                      props.stage.gate_status === 'awaiting_approval'
                    ? 'warning'
                    : 'outline'
              }
            >
              Gate {props.stage.gate_status}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border/60">
        <div
          className="h-2 rounded-full bg-accent transition-[width]"
          style={{ width: `${readStageProgressWidth(progressPercent)}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs leading-5 text-muted">
        <span>{props.stage.open_work_item_count} open work items still routed here</span>
        <span>
          Iteration {Math.max(1, props.stage.iteration_count)} • {props.stage.status}
        </span>
      </div>
    </div>
  );
}

function readStageProgressPercent(stage: DashboardWorkflowStageRecord): number | null {
  if (stage.total_work_item_count <= 0) {
    return null;
  }
  const completedCount = Math.max(0, stage.total_work_item_count - stage.open_work_item_count);
  return Math.min(
    100,
    Math.max(0, Math.round((completedCount / stage.total_work_item_count) * 100)),
  );
}

function readStageProgressWidth(percent: number | null): number {
  if (percent === null) {
    return 0;
  }
  if (percent === 0) {
    return 4;
  }
  return percent;
}
