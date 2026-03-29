import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import type {
  DashboardMissionControlWorkflowCard,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowSettingsRecord,
  DashboardWorkflowStickyStrip,
} from '../../lib/api.js';
import { formatRelativeTimestamp } from '../workflow-detail/workflow-detail-presentation.js';
import { WorkflowControlActions } from '../workflow-detail/workflow-control-actions.js';
import type { WorkflowWorkbenchTab } from './workflows-page.support.js';
import { isCompletedWorkItem } from './workflow-board.support.js';

export function WorkflowStateStrip(props: {
  workflow: DashboardMissionControlWorkflowCard;
  stickyStrip: DashboardWorkflowStickyStrip | null;
  workflowSettings: DashboardWorkflowSettingsRecord | null;
  board: DashboardWorkflowBoardResponse | null;
  selectedScopeLabel: string | null;
  addWorkLabel?: string;
  onTabChange(tab: WorkflowWorkbenchTab): void;
  onAddWork(): void;
  onOpenRedrive(): void;
  onVisibilityModeChange(nextMode: 'standard' | 'enhanced' | null): void;
}): JSX.Element {
  const sticky = props.stickyStrip;
  const workflowScopedActions = props.workflow.availableActions.filter(
    (action) => action.scope === 'workflow',
  );
  const visibilityValue = props.workflowSettings?.workflow_live_visibility_mode_override ?? '__inherit__';
  const workload = summarizeWorkload(props.board, props.workflow);
  const metaLine = `Updated ${formatRelativeTimestamp(props.workflow.metrics.lastChangedAt)}`;
  const canOpenRedrive = workflowScopedActions.some(
    (action) => action.kind === 'redrive_workflow' && action.enabled,
  );
  const canAddWork = workflowScopedActions.some(
    (action) => action.kind === 'add_work_item' && action.enabled,
  );
  const postureLabel = humanizePosture(sticky?.posture ?? props.workflow.posture);
  const isPausedWorkflow = props.workflow.state === 'paused' || sticky?.posture === 'paused';
  const isOngoingWorkflow = props.workflow.lifecycle === 'ongoing';
  const addWorkLabel = props.addWorkLabel ?? (isOngoingWorkflow ? 'Add Intake' : 'Add Work');
  const needsActionCount =
    (sticky?.approvals_count ?? 0) + (sticky?.escalations_count ?? 0) + (sticky?.blocked_work_item_count ?? 0);
  const activeSpecialistTaskCount = sticky?.active_task_count ?? props.workflow.metrics.activeTaskCount;
  const visibilityControlId = `workflow-live-visibility-${props.workflow.id}`;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.95fr)] xl:gap-6">
        <section className="grid gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Workflow
          </p>
          <div className="grid gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-foreground">{props.workflow.name}</h2>
              <Badge variant={isPausedWorkflow ? 'warning' : 'secondary'}>
                {isPausedWorkflow ? 'Workflow paused' : postureLabel}
              </Badge>
              {isOngoingWorkflow ? <Badge variant="outline">Ongoing</Badge> : null}
            </div>
            {metaLine ? <p className="text-sm text-muted-foreground">{metaLine}</p> : null}
            {props.selectedScopeLabel ? (
              <p className="text-sm text-muted-foreground">
                Workbench scope:{' '}
                <span className="font-medium text-foreground">{props.selectedScopeLabel}</span>
              </p>
            ) : null}
          </div>
        </section>

        <section className="grid gap-3 border-t border-border/60 pt-4 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Steering
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <WorkflowControlActions
              workflowId={props.workflow.id}
              workflowState={props.workflow.state}
              workflowPosture={sticky?.posture ?? props.workflow.posture}
              workspaceId={props.workflow.workspaceId}
              additionalQueryKeys={[['workflows']]}
              availableActions={props.workflow.availableActions}
            />
            {canOpenRedrive ? (
              <Button size="sm" variant="outline" onClick={props.onOpenRedrive}>
                Redrive
              </Button>
            ) : null}
            {canAddWork ? (
              <Button size="sm" onClick={props.onAddWork}>
                {addWorkLabel}
              </Button>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <label
              className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
              htmlFor={visibilityControlId}
            >
              Live visibility
            </label>
            <select
              id={visibilityControlId}
              className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
              value={visibilityValue}
              onChange={(event) =>
                props.onVisibilityModeChange(
                  event.target.value === '__inherit__'
                    ? null
                    : (event.target.value as 'standard' | 'enhanced'),
                )
              }
            >
              <option value="__inherit__">
                Inherit ({props.workflowSettings?.effective_live_visibility_mode ?? 'enhanced'})
              </option>
              <option value="standard">Standard</option>
              <option value="enhanced">Enhanced</option>
            </select>
          </div>
        </section>
      </div>

      <div className="grid gap-3 border-t border-border/60 pt-4 md:grid-cols-2 xl:grid-cols-4">
        <HeaderCard
          title="State"
          value={postureLabel}
          detail={readWorkflowStateDetail(sticky?.summary, postureLabel)}
        />
        <HeaderCard
          title="Needs Action"
          value={String(needsActionCount)}
          detail={`${sticky?.approvals_count ?? 0} approvals • ${sticky?.escalations_count ?? 0} escalations • ${sticky?.blocked_work_item_count ?? 0} blocked`}
          onClick={() => props.onTabChange('needs_action')}
        />
        <HeaderCard
          title="Work Items"
          value={String(workload.activeWorkItemCount)}
          detail={formatWorkItemDetail(workload)}
        />
        <HeaderCard
          title="Specialist Tasks"
          value={String(activeSpecialistTaskCount)}
          detail={formatSpecialistTaskDetail({
            activeSpecialistTaskCount,
            activeWorkItemCount: workload.activeWorkItemCount,
            lifecycle: props.workflow.lifecycle,
            posture: sticky?.posture ?? props.workflow.posture,
          })}
        />
      </div>
    </div>
  );
}

function HeaderCard(props: {
  title: string;
  value: string;
  detail: string | null;
  onClick?(): void;
}): JSX.Element {
  const className = 'grid gap-1 rounded-xl px-3 py-2 text-left';

  if (!props.onClick) {
    return (
      <div className={className}>
        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {props.title}
        </p>
        <p className="text-sm font-semibold leading-5 text-foreground sm:text-base">{props.value}</p>
        {props.detail ? <p className="text-[10px] leading-4 text-muted-foreground">{props.detail}</p> : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${className} transition-colors hover:bg-muted/20`}
      onClick={props.onClick}
    >
      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {props.title}
      </p>
      <p className="text-sm font-semibold leading-5 text-foreground sm:text-base">{props.value}</p>
      {props.detail ? <p className="text-[10px] leading-4 text-muted-foreground">{props.detail}</p> : null}
    </button>
  );
}

function formatWorkItemDetail(input: {
  activeWorkItemCount: number;
  completedWorkItemCount: number;
}): string | null {
  if (input.completedWorkItemCount > 0) {
    return `${input.completedWorkItemCount} completed`;
  }
  if (input.activeWorkItemCount > 0) {
    return 'In active lanes';
  }
  return 'No active work items';
}

function formatSpecialistTaskDetail(input: {
  activeSpecialistTaskCount: number;
  activeWorkItemCount: number;
  lifecycle: string | null;
  posture: string | null;
}): string | null {
  if (input.activeWorkItemCount === 0 && input.activeSpecialistTaskCount > 0) {
    return 'Orchestrating workflow setup';
  }
  if (
    input.activeSpecialistTaskCount === 0
    && (input.lifecycle === 'ongoing' || input.posture === 'waiting_by_design')
  ) {
    return 'Routing next step';
  }
  if (input.activeSpecialistTaskCount === 0) {
    return 'No active tasks';
  }
  return `${input.activeSpecialistTaskCount} active task${input.activeSpecialistTaskCount === 1 ? '' : 's'}`;
}

function humanizePosture(value: string | null | undefined): string {
  if (!value) {
    return 'Workflow';
  }
  if (value === 'waiting_by_design') {
    return 'Waiting for Work';
  }
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function summarizeWorkload(
  board: DashboardWorkflowBoardResponse | null,
  workflow: DashboardMissionControlWorkflowCard,
): {
  activeWorkItemCount: number;
  completedWorkItemCount: number;
} {
  if (!board) {
    return {
      activeWorkItemCount: workflow.metrics.activeWorkItemCount,
      completedWorkItemCount: 0,
    };
  }

  return {
    activeWorkItemCount: board.work_items.filter((workItem) => !isCompletedWorkItem(board.columns, workItem)).length,
    completedWorkItemCount: board.work_items.filter((workItem) => isCompletedWorkItem(board.columns, workItem)).length,
  };
}

function readOptionalSummary(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncateDetail(value: string): string {
  return value.length <= 72 ? value : `${value.slice(0, 69)}...`;
}

function readWorkflowStateDetail(summary: string | null | undefined, postureLabel: string): string | null {
  const detail = readOptionalSummary(summary);
  if (!detail) {
    return null;
  }
  const normalized = detail.trim().toLowerCase();
  if (normalized === 'workflow is waiting by design') {
    return null;
  }
  if (normalized === postureLabel.trim().toLowerCase()) {
    return null;
  }
  return truncateDetail(detail);
}
