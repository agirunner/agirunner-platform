import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import type {
  DashboardMissionControlWorkflowCard,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowStickyStrip,
} from '../../lib/api.js';
import { WorkflowControlActions } from '../workflow-detail/workflow-control-actions.js';
import type { WorkflowWorkbenchTab } from './workflows-page.support.js';
import {
  buildWorkflowHeaderState,
  formatNeedsActionDetail,
  formatSpecialistTaskDetail,
  formatWorkItemDetail,
  readNeedsActionCount,
  readWorkflowStateDetail,
} from './workflow-state-strip.support.js';

export function WorkflowStateStrip(props: {
  workflow: DashboardMissionControlWorkflowCard;
  stickyStrip: DashboardWorkflowStickyStrip | null;
  board: DashboardWorkflowBoardResponse | null;
  selectedScopeLabel: string | null;
  addWorkLabel?: string;
  onTabChange(tab: WorkflowWorkbenchTab): void;
  onAddWork(): void;
}): JSX.Element {
  const sticky = props.stickyStrip;
  const headerState = buildWorkflowHeaderState({
    workflow: props.workflow,
    stickyStrip: props.stickyStrip,
    board: props.board,
    addWorkLabel: props.addWorkLabel,
  });
  const isPausedWorkflow = props.workflow.state === 'paused' || sticky?.posture === 'paused';
  const selectedScopeLine = props.selectedScopeLabel ? `Work item · ${props.selectedScopeLabel}` : null;

  return (
    <div className="grid gap-3 sm:gap-4">
      <div className="grid gap-3 sm:gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.95fr)] xl:items-start xl:gap-6">
        <section className="grid gap-2.5 sm:gap-3">
          <div className="grid gap-2">
            <div
              data-workflow-header-meta="true"
              className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
            >
              <span>Playbook</span>
              {headerState.playbookLabel ? (
                <>
                  <span>{' · '}</span>
                  {props.workflow.playbookId ? (
                    <a
                      className="text-foreground underline-offset-4 hover:underline"
                      href={`/design/playbooks/${props.workflow.playbookId}`}
                    >
                      {headerState.playbookLabel}
                    </a>
                  ) : (
                    <span>{headerState.playbookLabel}</span>
                  )}
                </>
              ) : null}
              <span>{' · '}</span>
              <span>{headerState.updatedLabel}</span>
              {props.workflow.lifecycle === 'ongoing' ? (
                <Badge variant="outline">Ongoing</Badge>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-foreground">{props.workflow.name}</h2>
              <Badge variant={isPausedWorkflow ? 'warning' : 'secondary'}>
                {isPausedWorkflow ? 'Workflow paused' : headerState.postureLabel}
              </Badge>
            </div>
            {selectedScopeLine ? <p className="text-sm text-muted-foreground">{selectedScopeLine}</p> : null}
          </div>
        </section>

        <section className="flex min-w-0 flex-wrap items-start justify-start gap-2 xl:justify-end xl:pl-2">
          {headerState.effectiveWorkflowActions.length > 0 ? (
            <WorkflowControlActions
              workflowId={props.workflow.id}
              workflowState={props.workflow.state}
              workflowPosture={sticky?.posture ?? props.workflow.posture}
              workspaceId={props.workflow.workspaceId}
              additionalQueryKeys={[['workflows']]}
              availableActions={headerState.effectiveWorkflowActions}
            />
          ) : null}
          {headerState.canAddWork ? (
            <Button size="sm" onClick={props.onAddWork}>
              {headerState.addWorkLabel}
            </Button>
          ) : null}
        </section>
      </div>

      <div className="grid gap-2 pt-0.5 sm:gap-3 sm:pt-1 md:grid-cols-2 xl:grid-cols-4">
        <HeaderCard
          title="State"
          value={headerState.postureLabel}
          detail={readWorkflowStateDetail(sticky?.summary, headerState.postureLabel)}
        />
        <HeaderCard
          title="Needs Action"
          value={String(readNeedsActionCount(sticky))}
          detail={formatNeedsActionDetail(sticky)}
          onClick={() => props.onTabChange('needs_action')}
        />
        <HeaderCard
          title="Work Items"
          value={String(headerState.workload.activeWorkItemCount)}
          detail={formatWorkItemDetail(headerState.workload)}
        />
        <HeaderCard
          title="Specialist Tasks"
          value={String(headerState.activeSpecialistTaskCount)}
          detail={formatSpecialistTaskDetail({
            activeSpecialistTaskCount: headerState.activeSpecialistTaskCount,
            activeWorkItemCount: headerState.workload.activeWorkItemCount,
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
  const className = 'grid gap-1 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 text-left shadow-sm';
  const valueClassName = 'text-base font-semibold leading-5 text-foreground';

  if (!props.onClick) {
    return (
      <div className={className}>
        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {props.title}
        </p>
        <p className={valueClassName}>{props.value}</p>
        {props.detail ? <p className="text-[10px] leading-4 text-muted-foreground">{props.detail}</p> : null}
      </div>
    );
  }

  return (
      <button
        type="button"
        className={`${className} transition-colors hover:bg-muted/30`}
        onClick={props.onClick}
      >
      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {props.title}
      </p>
      <p className={valueClassName}>{props.value}</p>
      {props.detail ? <p className="text-[10px] leading-4 text-muted-foreground">{props.detail}</p> : null}
    </button>
  );
}
