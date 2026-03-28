import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type { DashboardWorkflowWorkspacePacket } from '../../../lib/api.js';
import type { WorkflowWorkbenchTab } from '../workflows-page.support.js';
import { WorkflowDeliverables } from './workflow-deliverables.js';
import { WorkflowHistory } from './workflow-history.js';
import { WorkflowLiveConsole } from './workflow-live-console.js';
import { WorkflowNeedsAction } from './workflow-needs-action.js';
import { WorkflowSteering } from './workflow-steering.js';

export function WorkflowBottomWorkbench(props: {
  workflowId: string;
  workflowName: string;
  workflowState: string | null | undefined;
  workspaceId: string | null | undefined;
  packet: DashboardWorkflowWorkspacePacket;
  activeTab: WorkflowWorkbenchTab;
  selectedWorkItemId: string | null;
  scopedWorkItemId: string | null;
  selectedWorkItemTitle: string | null;
  onTabChange(tab: WorkflowWorkbenchTab): void;
  onClearWorkItemScope(): void;
  onOpenAddWork(): void;
  onOpenRedrive(): void;
  onLoadMoreActivity(): void;
  onLoadMoreDeliverables(): void;
}): JSX.Element {
  const counts = props.packet.bottom_tabs.counts;

  return (
    <section className="grid gap-4 rounded-3xl border border-border/70 bg-background/90 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Workflow Workbench</p>
            {props.scopedWorkItemId ? (
              <>
                <Badge variant="secondary">
                  Work item: {props.selectedWorkItemTitle ?? props.scopedWorkItemId}
                </Badge>
                <Button type="button" size="sm" variant="outline" onClick={props.onClearWorkItemScope}>
                  Back to workflow
                </Button>
              </>
            ) : props.selectedWorkItemId ? (
              <Badge variant="outline">
                Board selection: {props.selectedWorkItemTitle ?? props.selectedWorkItemId}
              </Badge>
            ) : (
              <Badge variant="outline">Workflow scope</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Respond, steer, review live execution, inspect history, and read deliverables without leaving the workflow.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <WorkbenchTabButton
          label="Needs Action"
          count={counts.needs_action}
          isActive={props.activeTab === 'needs_action'}
          onClick={() => props.onTabChange('needs_action')}
        />
        <WorkbenchTabButton
          label="Steering"
          count={counts.steering}
          isActive={props.activeTab === 'steering'}
          onClick={() => props.onTabChange('steering')}
        />
        <WorkbenchTabButton
          label="Live Console"
          count={counts.live_console}
          isActive={props.activeTab === 'live_console'}
          onClick={() => props.onTabChange('live_console')}
        />
        <WorkbenchTabButton
          label="History"
          count={counts.history}
          isActive={props.activeTab === 'history'}
          onClick={() => props.onTabChange('history')}
        />
        <WorkbenchTabButton
          label="Deliverables"
          count={counts.deliverables}
          isActive={props.activeTab === 'deliverables'}
          onClick={() => props.onTabChange('deliverables')}
        />
      </div>

      <div className="min-h-[20rem]">
        {props.activeTab === 'needs_action' ? (
          <WorkflowNeedsAction
            packet={props.packet.needs_action}
            onOpenAddWork={props.onOpenAddWork}
            onOpenRedrive={props.onOpenRedrive}
            onOpenSteering={() => props.onTabChange('steering')}
          />
        ) : null}
        {props.activeTab === 'steering' ? (
          <WorkflowSteering
            workflowId={props.workflowId}
            workflowName={props.workflowName}
            workflowState={props.workflowState}
            workspaceId={props.workspaceId}
            selectedWorkItemId={props.scopedWorkItemId}
            quickActions={props.packet.steering_panel.quick_actions}
            decisionActions={props.packet.steering_panel.decision_actions}
            interventions={props.packet.steering_panel.recent_interventions}
            messages={props.packet.steering_panel.session.messages}
            sessionId={props.packet.steering_panel.session.session_id}
            canAcceptRequest={props.packet.steering_panel.steering_state.can_accept_request}
            onOpenAddWork={props.onOpenAddWork}
            onOpenRedrive={props.onOpenRedrive}
          />
        ) : null}
        {props.activeTab === 'live_console' ? (
          <WorkflowLiveConsole
            packet={props.packet.live_console}
            selectedWorkItemId={props.scopedWorkItemId}
            onLoadMore={props.onLoadMoreActivity}
          />
        ) : null}
        {props.activeTab === 'history' ? (
          <WorkflowHistory
            workflowId={props.workflowId}
            packet={props.packet.history_timeline}
            selectedWorkItemId={props.scopedWorkItemId}
            onLoadMore={props.onLoadMoreActivity}
          />
        ) : null}
        {props.activeTab === 'deliverables' ? (
          <WorkflowDeliverables
            packet={props.packet.deliverables_panel}
            onLoadMore={props.onLoadMoreDeliverables}
          />
        ) : null}
      </div>
    </section>
  );
}

function WorkbenchTabButton(props: {
  label: string;
  count: number;
  isActive: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={
        props.isActive
          ? 'flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-100/90 px-4 py-2 text-sm font-semibold text-amber-950 shadow-sm dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-50'
          : 'flex items-center gap-2 rounded-2xl border border-border/70 bg-background/80 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-background'
      }
      onClick={props.onClick}
    >
      <span>{props.label}</span>
      <Badge variant={props.isActive ? 'secondary' : 'outline'}>{props.count}</Badge>
    </button>
  );
}
