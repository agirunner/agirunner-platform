import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type {
  DashboardTaskRecord,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowWorkspacePacket,
  DashboardWorkflowWorkItemRecord,
} from '../../../lib/api.js';
import type {
  WorkflowWorkbenchScopeDescriptor,
  WorkflowWorkbenchTab,
} from '../workflows-page.support.js';
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
  scope: WorkflowWorkbenchScopeDescriptor;
  onTabChange(tab: WorkflowWorkbenchTab): void;
  onClearWorkItemScope(): void;
  onClearTaskScope(): void;
  onOpenAddWork(workItemId?: string | null): void;
  onOpenRedrive(): void;
  onLoadMoreActivity(): void;
  onLoadMoreDeliverables(): void;
}): JSX.Element {
  const currentTaskId =
    props.packet.bottom_tabs.current_task_id
    ?? props.packet.selected_scope.task_id
    ?? props.selectedTaskId;
  const currentWorkItemId =
    props.packet.bottom_tabs.current_work_item_id
    ?? props.packet.selected_scope.work_item_id
    ?? props.scopedWorkItemId
    ?? props.selectedWorkItemId;
  const currentTaskTitle =
    props.selectedTask?.id === currentTaskId
      ? props.selectedTask.title
      : props.selectedTaskTitle;
  const currentWorkItemTitle =
    props.selectedWorkItem?.id === currentWorkItemId
      ? props.selectedWorkItem.title
      : props.selectedTask?.work_item_id === currentWorkItemId
        ? props.selectedTask.work_item_title ?? props.selectedWorkItemTitle
        : props.selectedWorkItemTitle;
  const resolvedScope = resolveWorkbenchScope({
    ...props,
    selectedWorkItemTitle: currentWorkItemTitle,
    selectedTaskTitle: currentTaskTitle,
  });
  const counts = props.packet.bottom_tabs.counts;
  const liveConsoleCount = props.packet.live_console.total_count ?? counts.live_console_activity;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-muted/5 px-3 py-2">
        <div className="grid gap-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {`Showing ${resolvedScope.title}`}
          </p>
          <p className="text-sm font-semibold text-foreground">{resolvedScope.banner}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {resolvedScope.scopeKind === 'selected_task' ? (
            <Button type="button" size="sm" variant="ghost" onClick={props.onClearTaskScope}>
              Show work item
            </Button>
          ) : null}
          {resolvedScope.scopeKind !== 'workflow' ? (
            <Button type="button" size="sm" variant="ghost" onClick={props.onClearWorkItemScope}>
              Show workflow
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap gap-2">
        <WorkbenchTabButton
          label="Details"
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
          count={liveConsoleCount}
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

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {props.activeTab === 'details' && props.workflow ? (
          <WorkflowDetails
            workflow={props.workflow}
            stickyStrip={props.stickyStrip}
            board={props.board}
            selectedWorkItemId={currentWorkItemId}
            selectedWorkItemTitle={currentWorkItemTitle}
            selectedTaskId={currentTaskId}
            selectedTaskTitle={currentTaskTitle}
            selectedWorkItem={props.selectedWorkItem}
            selectedTask={props.selectedTask}
            selectedWorkItemTasks={props.selectedWorkItemTasks}
            inputPackets={props.inputPackets}
            workflowParameters={props.workflowParameters}
            scope={resolvedScope}
          />
        ) : null}
        {props.activeTab === 'needs_action' && props.workflow ? (
          <WorkflowNeedsAction
            workflowId={props.workflowId}
            workspaceId={props.workflow.workspaceId}
            packet={props.packet.needs_action}
            scopeSubject={resolvedScope.subject}
            scopeLabel={resolvedScope.banner}
            onOpenAddWork={(workItemId) => props.onOpenAddWork(workItemId)}
          />
        ) : null}
        {props.activeTab === 'steering' ? (
          <WorkflowSteering
            workflowId={props.workflowId}
            workflowName={props.workflowName}
            selectedWorkItemId={currentWorkItemId}
            scope={resolvedScope}
            interventions={props.packet.steering.recent_interventions}
            messages={props.packet.steering.session.messages}
            sessionId={props.packet.steering.session.session_id}
            canAcceptRequest={props.packet.steering.steering_state.can_accept_request}
          />
        ) : null}
        {props.activeTab === 'live_console' ? (
          <WorkflowLiveConsole
            packet={props.packet.live_console}
            scopeLabel={resolvedScope.banner}
            scopeSubject={resolvedScope.subject}
            onLoadMore={props.onLoadMoreActivity}
          />
        ) : null}
        {props.activeTab === 'history' ? (
          <WorkflowHistory
            workflowId={props.workflowId}
            packet={props.packet.history}
            selectedWorkItemId={currentWorkItemId}
            selectedTaskId={currentTaskId}
            scopeSubject={resolvedScope.subject}
            onLoadMore={props.onLoadMoreActivity}
          />
        ) : null}
        {props.activeTab === 'deliverables' ? (
          <WorkflowDeliverables
            packet={props.packet.deliverables}
            selectedTask={props.selectedTask}
            selectedWorkItemId={currentWorkItemId}
            selectedWorkItemTitle={currentWorkItemTitle}
            scope={resolvedScope}
            onLoadMore={props.onLoadMoreDeliverables}
          />
        ) : null}
      </div>
    </section>
  );
}

function resolveWorkbenchScope(props: {
  packet: DashboardWorkflowWorkspacePacket;
  workflowName: string;
  selectedWorkItemTitle: string | null;
  selectedTaskTitle: string | null;
  scope: WorkflowWorkbenchScopeDescriptor;
}): WorkflowWorkbenchScopeDescriptor {
  const scopeKind = props.packet.bottom_tabs.current_scope_kind;
  const workItemId =
    props.packet.bottom_tabs.current_work_item_id
    ?? props.packet.selected_scope.work_item_id;
  const taskId =
    props.packet.bottom_tabs.current_task_id
    ?? props.packet.selected_scope.task_id;

  if (scopeKind === 'selected_task') {
    const taskName = props.selectedTaskTitle ?? taskId ?? props.scope.name;
    return {
      scopeKind,
      title: 'Task',
      subject: 'task',
      name: taskName,
      banner: `Task: ${taskName}`,
    };
  }

  if (scopeKind === 'selected_work_item') {
    const workItemName = props.selectedWorkItemTitle ?? workItemId ?? props.scope.name;
    return {
      scopeKind,
      title: 'Work item',
      subject: 'work item',
      name: workItemName,
      banner: `Work item: ${workItemName}`,
    };
  }

  return {
    scopeKind: 'workflow',
    title: 'Workflow',
    subject: 'workflow',
    name: props.workflowName,
    banner: `Workflow: ${props.workflowName}`,
  };
}

function WorkbenchTabButton(props: {
  label: string;
  count?: number;
  isActive: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={
        props.isActive
          ? 'flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-100/90 px-3 py-1.5 text-xs font-semibold text-amber-950 shadow-sm dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-50'
          : 'flex items-center gap-2 rounded-xl border border-border/70 bg-background/80 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-background'
      }
      onClick={props.onClick}
    >
      <span>{props.label}</span>
      {props.count && props.count > 0 ? (
        <Badge variant={props.isActive ? 'secondary' : 'outline'}>{props.count}</Badge>
      ) : null}
    </button>
  );
}
