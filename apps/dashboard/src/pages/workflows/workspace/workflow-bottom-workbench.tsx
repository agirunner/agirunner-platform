import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type {
  DashboardTaskRecord,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowWorkspacePacket,
  DashboardWorkflowWorkItemRecord,
} from '../../../lib/api.js';
import type { WorkflowWorkbenchTab } from '../workflows-page.support.js';
import { WorkflowDeliverables } from './workflow-deliverables.js';
import { WorkflowDetails } from './workflow-details.js';
import { WorkflowHistory } from './workflow-history.js';
import { WorkflowLiveConsole } from './workflow-live-console.js';
import { WorkflowNeedsAction } from './workflow-needs-action.js';
import { WorkflowSteering } from './workflow-steering.js';

export function WorkflowBottomWorkbench(props: {
  workflowId: string;
  workflow: DashboardWorkflowWorkspacePacket['workflow'];
  stickyStrip: DashboardWorkflowWorkspacePacket['sticky_strip'];
  board: DashboardWorkflowWorkspacePacket['board'];
  workflowName: string;
  packet: DashboardWorkflowWorkspacePacket;
  activeTab: WorkflowWorkbenchTab;
  selectedWorkItemId: string | null;
  scopedWorkItemId: string | null;
  selectedWorkItemTitle: string | null;
  selectedTaskId: string | null;
  selectedTaskTitle: string | null;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
  selectedTask: DashboardTaskRecord | null;
  selectedWorkItemTasks: Record<string, unknown>[];
  inputPackets: DashboardWorkflowInputPacketRecord[];
  workflowParameters: Record<string, unknown> | null;
  onTabChange(tab: WorkflowWorkbenchTab): void;
  onClearWorkItemScope(): void;
  onClearTaskScope(): void;
  onOpenAddWork(): void;
  onOpenRedrive(): void;
  onLoadMoreActivity(): void;
  onLoadMoreDeliverables(): void;
}): JSX.Element {
  const counts = props.packet.bottom_tabs.counts;

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {props.selectedTaskId ? (
          <>
            <Badge variant="secondary">Task: {props.selectedTaskTitle ?? props.selectedTaskId}</Badge>
            <Button type="button" size="sm" variant="outline" onClick={props.onClearTaskScope}>
              Back to work item
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={props.onClearWorkItemScope}>
              Back to workflow
            </Button>
          </>
        ) : props.scopedWorkItemId ? (
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

      <div className="flex flex-wrap gap-2">
        <WorkbenchTabButton
          label="Details"
          count={counts.details}
          isActive={props.activeTab === 'details'}
          onClick={() => props.onTabChange('details')}
        />
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
          count={counts.live_console_activity}
          isActive={props.activeTab === 'live_console'}
          onClick={() => props.onTabChange('live_console')}
        />
        <WorkbenchTabButton
          label="Briefs"
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

      <div className="min-h-0 flex-1 overflow-auto">
        {props.activeTab === 'details' && props.workflow ? (
          <WorkflowDetails
            workflow={props.workflow}
            stickyStrip={props.stickyStrip}
            board={props.board}
            selectedWorkItemId={props.selectedWorkItemId}
            selectedWorkItemTitle={props.selectedWorkItemTitle}
            selectedTaskId={props.selectedTaskId}
            selectedTaskTitle={props.selectedTaskTitle}
            selectedWorkItem={props.selectedWorkItem}
            selectedTask={props.selectedTask}
            selectedWorkItemTasks={props.selectedWorkItemTasks}
            inputPackets={props.inputPackets}
            workflowParameters={props.workflowParameters}
          />
        ) : null}
        {props.activeTab === 'needs_action' && props.workflow ? (
          <WorkflowNeedsAction
            workflowId={props.workflowId}
            workspaceId={props.workflow.workspaceId}
            packet={props.packet.needs_action}
          />
        ) : null}
        {props.activeTab === 'steering' ? (
          <WorkflowSteering
            workflowId={props.workflowId}
            workflowName={props.workflowName}
            selectedWorkItemId={props.scopedWorkItemId}
            interventions={props.packet.steering.recent_interventions}
            messages={props.packet.steering.session.messages}
            sessionId={props.packet.steering.session.session_id}
            canAcceptRequest={props.packet.steering.steering_state.can_accept_request}
          />
        ) : null}
        {props.activeTab === 'live_console' ? (
          <WorkflowLiveConsole
            packet={props.packet.live_console}
            selectedWorkItemId={props.scopedWorkItemId}
            selectedTaskId={props.selectedTaskId}
            onLoadMore={props.onLoadMoreActivity}
          />
        ) : null}
        {props.activeTab === 'history' ? (
          <WorkflowHistory
            workflowId={props.workflowId}
            packet={props.packet.history}
            selectedWorkItemId={props.scopedWorkItemId}
            selectedTaskId={props.selectedTaskId}
            onLoadMore={props.onLoadMoreActivity}
          />
        ) : null}
        {props.activeTab === 'deliverables' ? (
          <WorkflowDeliverables
            packet={props.packet.deliverables}
            selectedTask={props.selectedTask}
            selectedWorkItemTitle={props.selectedWorkItemTitle}
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
      {props.count > 0 ? <Badge variant={props.isActive ? 'secondary' : 'outline'}>{props.count}</Badge> : null}
    </button>
  );
}
