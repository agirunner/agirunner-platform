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
  selectedTaskId?: string | null;
  selectedTaskTitle?: string | null;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
  selectedTask?: DashboardTaskRecord | null;
  selectedWorkItemTasks: Record<string, unknown>[];
  inputPackets: DashboardWorkflowInputPacketRecord[];
  workflowParameters: Record<string, unknown> | null;
  scope: WorkflowWorkbenchScopeDescriptor;
  isScopeLoading?: boolean;
  onTabChange(tab: WorkflowWorkbenchTab): void;
  onClearWorkItemScope(): void;
  onClearTaskScope?(): void;
  onOpenAddWork(workItemId?: string | null): void;
  onOpenRedrive(): void;
  onLoadMoreActivity(): void;
  onLoadMoreDeliverables(): void;
}): JSX.Element {
  const currentWorkItemId =
    props.packet.bottom_tabs.current_work_item_id
    ?? props.packet.selected_scope.work_item_id
    ?? props.scopedWorkItemId
    ?? props.selectedWorkItemId;
  const currentWorkItem =
    props.selectedWorkItem?.id === currentWorkItemId
      ? props.selectedWorkItem
      : props.board?.work_items.find((workItem) => workItem.id === currentWorkItemId) ?? null;
  const currentWorkItemTitle = props.selectedWorkItem?.id === currentWorkItemId
    ? props.selectedWorkItem.title
    : currentWorkItem?.title ?? props.selectedWorkItemTitle;
  const currentScopedTaskRows = currentWorkItemId ? props.selectedWorkItemTasks : [];
  const currentTaskId =
    props.packet.bottom_tabs.current_task_id
    ?? props.packet.selected_scope.task_id
    ?? props.selectedTaskId
    ?? null;
  const currentTask =
    props.selectedTask?.id === currentTaskId
      ? props.selectedTask
      : currentTaskId
        ? resolveScopedTaskRecord(currentScopedTaskRows, currentTaskId)
        : null;
  const resolvedScope = resolveWorkbenchScope({
    ...props,
    selectedWorkItemTitle: currentWorkItemTitle,
  });
  const counts = props.packet.bottom_tabs.counts;
  const liveConsoleCount = props.isScopeLoading
    ? undefined
    : props.packet.live_console.total_count ?? counts.live_console_activity;
  const tabPanelShellClassName = 'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden';
  const liveConsoleTabPanelContentClassName =
    'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 py-4';
  const scrollableTabPanelContentClassName =
    'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4';

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="grid gap-0.5">
          <p className="text-sm font-semibold text-foreground">Workflow Workbench</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Scope
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline">{resolvedScope.title}</Badge>
            <p className="text-sm font-semibold text-foreground">{resolvedScope.banner}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {resolvedScope.scopeKind !== 'workflow' ? (
            <Button type="button" size="sm" variant="ghost" onClick={props.onClearWorkItemScope}>
              Show workflow
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 gap-2 overflow-x-auto border-b border-border/60 px-4 py-2.5 pb-3 sm:flex-wrap sm:overflow-visible sm:pb-2.5">
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

      <div className={tabPanelShellClassName}>
        {props.activeTab === 'live_console' ? (
          <div className={liveConsoleTabPanelContentClassName}>
            <WorkflowLiveConsole
              packet={props.packet.live_console}
              scopeLabel={resolvedScope.banner}
              scopeSubject={resolvedScope.subject}
              isScopeLoading={props.isScopeLoading}
              onLoadMore={props.onLoadMoreActivity}
            />
          </div>
        ) : (
          <div className={scrollableTabPanelContentClassName}>
            <div className="flex min-h-full min-w-0 flex-1 flex-col">
              {props.activeTab === 'details' && props.workflow ? (
                <WorkflowDetails
                  workflow={props.workflow}
                  stickyStrip={props.stickyStrip}
                  board={props.board}
                  selectedWorkItemId={currentWorkItemId}
                  selectedWorkItemTitle={currentWorkItemTitle}
                  selectedTaskId={null}
                  selectedTaskTitle={null}
                  selectedWorkItem={currentWorkItem}
                  selectedTask={currentTask}
                  selectedWorkItemTasks={currentScopedTaskRows}
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
                  workflowState={props.workflow?.state ?? 'active'}
                  boardColumns={props.board?.columns ?? []}
                  selectedWorkItemId={currentWorkItemId}
                  selectedWorkItemTitle={currentWorkItemTitle}
                  selectedWorkItem={currentWorkItem}
                  selectedTaskId={null}
                  selectedTaskTitle={null}
                  selectedTask={null}
                  selectedWorkItemTasks={props.selectedWorkItemTasks as unknown as DashboardTaskRecord[]}
                  scope={resolvedScope}
                  interventions={props.packet.steering.recent_interventions}
                  messages={props.packet.steering.session.messages}
                  sessionId={props.packet.steering.session.session_id}
                  canAcceptRequest={props.packet.steering.steering_state.can_accept_request}
                />
              ) : null}
              {props.activeTab === 'history' ? (
                <WorkflowHistory
                  workflowId={props.workflowId}
                  packet={props.packet.history}
                  selectedWorkItemId={currentWorkItemId}
                  selectedTaskId={null}
                  scopeSubject={resolvedScope.subject}
                  onLoadMore={props.onLoadMoreActivity}
                />
              ) : null}
              {props.activeTab === 'deliverables' ? (
                <WorkflowDeliverables
                  packet={props.packet.deliverables}
                  selectedTask={null}
                  selectedWorkItemId={currentWorkItemId}
                  selectedWorkItemTitle={currentWorkItemTitle}
                  scope={resolvedScope}
                  onLoadMore={props.onLoadMoreDeliverables}
                />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function resolveWorkbenchScope(props: {
  packet: DashboardWorkflowWorkspacePacket;
  workflowName: string;
  selectedWorkItemTitle: string | null;
  scope: WorkflowWorkbenchScopeDescriptor;
}): WorkflowWorkbenchScopeDescriptor {
  const scopeKind = props.packet.bottom_tabs.current_scope_kind;
  const workItemId =
    props.packet.bottom_tabs.current_work_item_id
    ?? props.packet.selected_scope.work_item_id;

  if (scopeKind === 'selected_work_item' || scopeKind === 'selected_task') {
    const workItemName = props.selectedWorkItemTitle ?? workItemId ?? props.scope.name;
    return {
      scopeKind: 'selected_work_item',
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

function resolveScopedTaskRecord(
  tasks: Record<string, unknown>[],
  taskId: string,
): DashboardTaskRecord | null {
  const record = tasks.find((task) => typeof task.id === 'string' && task.id === taskId);
  return record ? (record as unknown as DashboardTaskRecord) : null;
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
          ? 'flex shrink-0 items-center gap-2 rounded-xl border border-sky-300 bg-sky-100/90 px-3 py-1.5 text-xs font-semibold text-sky-950 shadow-sm dark:border-sky-400/60 dark:bg-sky-400/15 dark:text-sky-50'
          : 'flex shrink-0 items-center gap-2 rounded-xl border border-border/70 bg-background/80 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-background'
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
