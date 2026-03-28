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
  onTabChange(tab: WorkflowWorkbenchTab): void;
  onAddWork(): void;
  onOpenRedrive(): void;
  onVisibilityModeChange(nextMode: 'standard' | 'enhanced' | null): void;
}): JSX.Element {
  const sticky = props.stickyStrip;
  const visibilityValue = props.workflowSettings?.workflow_live_visibility_mode_override ?? '__inherit__';
  const workload = summarizeWorkload(props.board, props.workflow);
  const metaLine = [
    `Updated ${formatRelativeTimestamp(props.workflow.metrics.lastChangedAt)}`,
    props.selectedScopeLabel ? `Focused on ${props.selectedScopeLabel}` : null,
  ].filter(Boolean).join(' • ');
  const canOpenRedrive = props.workflow.availableActions.some(
    (action) => action.kind === 'redrive_workflow' && action.enabled,
  );
  const postureLabel = humanizePosture(sticky?.posture ?? props.workflow.posture);
  const isOngoingWorkflow = props.workflow.lifecycle === 'ongoing';
  const needsActionCount =
    (sticky?.approvals_count ?? 0) + (sticky?.escalations_count ?? 0) + (sticky?.blocked_work_item_count ?? 0);

  return (
    <section className="space-y-2 rounded-3xl border border-border/70 bg-background/90 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{props.workflow.name}</h2>
            <Badge variant="secondary">{postureLabel}</Badge>
            {isOngoingWorkflow ? <Badge variant="outline">Ongoing</Badge> : null}
          </div>
          {metaLine ? <p className="text-[11px] text-muted-foreground">{metaLine}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <WorkflowControlActions
            workflowId={props.workflow.id}
            workflowState={props.workflow.state}
            workspaceId={props.workflow.workspaceId}
            additionalQueryKeys={[['workflows']]}
            availableActions={props.workflow.availableActions}
          />
          {canOpenRedrive ? (
            <Button size="sm" variant="outline" onClick={props.onOpenRedrive}>
              Redrive
            </Button>
          ) : null}
          <Button size="sm" onClick={props.onAddWork}>
            Add / Modify Work
          </Button>
          <label className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/10 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Live visibility</span>
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground"
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
          </label>
        </div>
      </div>

      <div className="grid gap-2 xl:grid-cols-4">
        <HeaderCard
          title="Workflow State"
          value={postureLabel}
          detail={readOptionalSummary(sticky?.summary) ?? 'Current workflow posture'}
        />
        <HeaderCard
          title="Needs Action"
          value={String(needsActionCount)}
          detail={`${sticky?.approvals_count ?? 0} approvals • ${sticky?.escalations_count ?? 0} escalations • ${sticky?.blocked_work_item_count ?? 0} blocked`}
          onClick={() => props.onTabChange('needs_action')}
        />
        <HeaderCard
          title="Workload"
          value={`${workload.activeWorkItemCount} active • ${workload.completedWorkItemCount} done`}
          detail={`${sticky?.active_task_count ?? props.workflow.metrics.activeTaskCount} specialist tasks`}
        />
        <HeaderCard
          title="Steering"
          value={sticky?.steering_available ? 'Open' : 'Idle'}
          detail="Requests, responses, and intervention history"
          onClick={() => props.onTabChange('steering')}
        />
      </div>
    </section>
  );
}

function HeaderCard(props: {
  title: string;
  value: string;
  detail: string;
  onClick?(): void;
}): JSX.Element {
  const content = (
    <div className="grid gap-1 rounded-2xl border border-border/70 bg-muted/10 p-2.5 text-left">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {props.title}
      </p>
      <p className="text-sm font-semibold leading-5 text-foreground">{props.value}</p>
      <p className="text-[11px] leading-4 text-muted-foreground">{props.detail}</p>
    </div>
  );

  if (!props.onClick) {
    return content;
  }

  return (
    <button
      type="button"
      className="rounded-2xl transition-colors hover:bg-muted/20"
      onClick={props.onClick}
    >
      {content}
    </button>
  );
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
