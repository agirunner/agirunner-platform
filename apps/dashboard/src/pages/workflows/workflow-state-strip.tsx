import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import type {
  DashboardMissionControlWorkflowCard,
  DashboardWorkflowSettingsRecord,
  DashboardWorkflowStickyStrip,
} from '../../lib/api.js';
import { formatRelativeTimestamp } from '../workflow-detail/workflow-detail-presentation.js';
import { WorkflowControlActions } from '../workflow-detail/workflow-control-actions.js';
import type { WorkflowWorkbenchTab } from './workflows-page.support.js';

export function WorkflowStateStrip(props: {
  workflow: DashboardMissionControlWorkflowCard;
  stickyStrip: DashboardWorkflowStickyStrip | null;
  workflowSettings: DashboardWorkflowSettingsRecord | null;
  selectedScopeLabel: string | null;
  onTabChange(tab: WorkflowWorkbenchTab): void;
  onAddWork(): void;
  onVisibilityModeChange(nextMode: 'standard' | 'enhanced' | null): void;
}): JSX.Element {
  const sticky = props.stickyStrip;
  const visibilityValue = props.workflowSettings?.workflow_live_visibility_mode_override ?? '__inherit__';

  return (
    <section className="space-y-4 rounded-3xl border border-border/70 bg-background/90 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold text-foreground">{props.workflow.name}</h2>
            {props.workflow.currentStage ? <Badge variant="outline">{props.workflow.currentStage}</Badge> : null}
            <Badge variant="secondary">{humanizePosture(sticky?.posture ?? props.workflow.posture)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {[props.workflow.playbookName, props.workflow.workspaceName].filter(Boolean).join(' • ') || 'Workflow'}
          </p>
          <p className="max-w-4xl text-sm text-foreground">{sticky?.summary ?? props.workflow.pulse.summary}</p>
          <p className="text-xs text-muted-foreground">
            Last changed {formatRelativeTimestamp(props.workflow.metrics.lastChangedAt)}
            {props.selectedScopeLabel ? ` • Viewing ${props.selectedScopeLabel}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <WorkflowControlActions
            workflowId={props.workflow.id}
            workflowState={props.workflow.state}
            workspaceId={props.workflow.workspaceId}
            additionalQueryKeys={[['workflows']]}
            availableActions={props.workflow.availableActions}
          />
          <Button size="sm" onClick={props.onAddWork}>
            Add / Modify Work
          </Button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.5fr_1fr_1fr_1.1fr]">
        <InfoCard
          title="Workflow State"
          body={sticky?.summary ?? props.workflow.pulse.summary}
          footer={`${props.workflow.lifecycle ?? 'workflow'} • ${sticky?.active_work_item_count ?? props.workflow.metrics.activeWorkItemCount} active work items`}
        />
        <TabShortcutCard
          title="Needs Action"
          value={String((sticky?.approvals_count ?? 0) + (sticky?.escalations_count ?? 0) + (sticky?.blocked_work_item_count ?? 0))}
          detail={`${sticky?.approvals_count ?? 0} approvals • ${sticky?.escalations_count ?? 0} escalations • ${sticky?.blocked_work_item_count ?? 0} blocked`}
          onClick={() => props.onTabChange('needs_action')}
        />
        <InfoCard
          title="Progress"
          body={`${sticky?.active_work_item_count ?? props.workflow.metrics.activeWorkItemCount} work items • ${sticky?.active_task_count ?? props.workflow.metrics.activeTaskCount} tasks in flight`}
          footer={`${props.workflow.metrics.failedTaskCount} failed tasks • ${props.workflow.metrics.blockedWorkItemCount} blocked work items`}
        />
        <div className="grid gap-3 rounded-2xl border border-border/70 bg-muted/10 p-4">
          <TabShortcutCard
            title="Steering"
            value={sticky?.steering_available ? 'Open' : 'Idle'}
            detail="Requests, responses, inputs, and workflow-safe intervention history."
            onClick={() => props.onTabChange('steering')}
            compact
          />
          <label className="grid gap-2 text-sm">
            <span className="font-medium text-foreground">Live visibility</span>
            <select
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
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
                Inherit tenant default ({props.workflowSettings?.effective_live_visibility_mode ?? 'enhanced'})
              </option>
              <option value="standard">Standard</option>
              <option value="enhanced">Enhanced</option>
            </select>
          </label>
        </div>
      </div>
    </section>
  );
}

function InfoCard(props: {
  title: string;
  body: string;
  footer: string;
}): JSX.Element {
  return (
    <div className="grid gap-2 rounded-2xl border border-border/70 bg-muted/10 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {props.title}
      </p>
      <p className="text-sm text-foreground">{props.body}</p>
      <p className="text-xs text-muted-foreground">{props.footer}</p>
    </div>
  );
}

function TabShortcutCard(props: {
  title: string;
  value: string;
  detail: string;
  compact?: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="grid gap-2 rounded-2xl border border-border/70 bg-muted/10 p-4 text-left transition-colors hover:bg-muted/20"
      onClick={props.onClick}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {props.title}
      </p>
      <p className={props.compact ? 'text-lg font-semibold text-foreground' : 'text-2xl font-semibold text-foreground'}>
        {props.value}
      </p>
      <p className="text-xs text-muted-foreground">{props.detail}</p>
    </button>
  );
}

function humanizePosture(value: string | null | undefined): string {
  if (!value) {
    return 'Workflow';
  }
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
