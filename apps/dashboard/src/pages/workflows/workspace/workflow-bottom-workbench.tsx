import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type {
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowWorkspacePacket,
  DashboardWorkflowWorkItemRecord,
} from '../../../lib/api.js';
import type {
  WorkflowWorkbenchScopeDescriptor,
  WorkflowWorkbenchTab,
} from '../workflows-page.support.js';
import { resolveWorkbenchScope } from './workbench/workflow-bottom-workbench.scope.js';
import { WorkflowDeliverables } from './workflow-deliverables.js';
import { WorkflowDetails } from './workflow-details.js';
import { WorkflowLiveConsole } from './workflow-live-console.js';
import { WorkflowNeedsAction } from './workflow-needs-action.js';

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
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
  selectedWorkItemTasks: Record<string, unknown>[];
  inputPackets: DashboardWorkflowInputPacketRecord[];
  workflowParameters: Record<string, unknown> | null;
  scope: WorkflowWorkbenchScopeDescriptor;
  isScopeLoading?: boolean;
  onTabChange(tab: WorkflowWorkbenchTab): void;
  onClearWorkItemScope(): void;
  onOpenAddWork(workItemId?: string | null): void;
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
  const resolvedScope = resolveWorkbenchScope({
    ...props,
    selectedWorkItemTitle: currentWorkItemTitle,
  });
  const activeTab = props.activeTab;
  const counts = props.packet.bottom_tabs.counts;
  const liveConsoleCount = props.isScopeLoading
    ? undefined
    : props.packet.live_console.total_count ?? counts.live_console_activity;
  const activeTabId = `workflow-workbench-tab-${activeTab}`;
  const activePanelId = `workflow-workbench-panel-${activeTab}`;
  const tabPanelShellClassName = 'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden';
  const liveConsoleTabPanelContentClassName =
    'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 py-4';
  const scrollableTabPanelContentClassName =
    'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4';

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-foreground">{resolvedScope.banner}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {resolvedScope.scopeKind !== 'workflow' ? (
            <Button type="button" size="sm" variant="ghost" onClick={props.onClearWorkItemScope}>
              Show workflow
            </Button>
          ) : null}
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Workflow workbench tabs"
        className="flex min-w-0 gap-1.5 overflow-x-auto px-3 pb-2.5 pt-2 sm:flex-wrap sm:overflow-visible"
      >
        <WorkbenchTabButton
          tabId="workflow-workbench-tab-details"
          panelId="workflow-workbench-panel-details"
          label="Details"
          isActive={activeTab === 'details'}
          onClick={() => props.onTabChange('details')}
        />
        <WorkbenchTabButton
          tabId="workflow-workbench-tab-needs_action"
          panelId="workflow-workbench-panel-needs_action"
          label="Needs Action"
          count={counts.needs_action}
          isActive={activeTab === 'needs_action'}
          onClick={() => props.onTabChange('needs_action')}
        />
        <WorkbenchTabButton
          tabId="workflow-workbench-tab-live_console"
          panelId="workflow-workbench-panel-live_console"
          label="Live Console"
          count={liveConsoleCount}
          isActive={activeTab === 'live_console'}
          onClick={() => props.onTabChange('live_console')}
        />
        <WorkbenchTabButton
          tabId="workflow-workbench-tab-deliverables"
          panelId="workflow-workbench-panel-deliverables"
          label="Deliverables"
          count={counts.deliverables}
          isActive={activeTab === 'deliverables'}
          onClick={() => props.onTabChange('deliverables')}
        />
      </div>

      <div
        id={activePanelId}
        role="tabpanel"
        aria-labelledby={activeTabId}
        data-workflows-workbench-panel={activeTab}
        className={tabPanelShellClassName}
      >
        {activeTab === 'live_console' ? (
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
            {activeTab === 'details' && props.workflow ? (
              <WorkflowDetails
                workflow={props.workflow}
                stickyStrip={props.stickyStrip}
                board={props.board}
                selectedWorkItemId={currentWorkItemId}
                selectedWorkItemTitle={currentWorkItemTitle}
                selectedWorkItem={currentWorkItem}
                selectedWorkItemTasks={currentScopedTaskRows}
                inputPackets={props.inputPackets}
                workflowParameters={props.workflowParameters}
                scope={resolvedScope}
              />
            ) : null}
            {activeTab === 'needs_action' && props.workflow ? (
              <WorkflowNeedsAction
                workflowId={props.workflowId}
                workspaceId={props.workflow.workspaceId}
                packet={props.packet.needs_action}
                scopeSubject={resolvedScope.subject}
                scopeLabel={resolvedScope.banner}
                onOpenAddWork={(workItemId) => props.onOpenAddWork(workItemId)}
              />
            ) : null}
            {activeTab === 'deliverables' ? (
              <WorkflowDeliverables
                packet={props.packet.deliverables}
                selectedWorkItemId={currentWorkItemId}
                selectedWorkItemTitle={currentWorkItemTitle}
                scope={resolvedScope}
                onLoadMore={props.onLoadMoreDeliverables}
              />
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function WorkbenchTabButton(props: {
  tabId: string;
  panelId: string;
  label: string;
  count?: number;
  isActive: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      id={props.tabId}
      role="tab"
      aria-selected={props.isActive}
      aria-controls={props.panelId}
      tabIndex={props.isActive ? 0 : -1}
      type="button"
      className={
        props.isActive
          ? 'flex shrink-0 items-center gap-2 rounded-t-lg border border-border/70 bg-background px-3 py-2 text-sm font-semibold text-foreground shadow-sm'
          : 'flex shrink-0 items-center gap-2 rounded-t-lg border border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground'
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
