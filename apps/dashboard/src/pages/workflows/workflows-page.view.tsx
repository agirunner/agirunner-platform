import type { PointerEvent, RefObject } from 'react';
import { LayoutDashboard, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Button } from '../../components/ui/button.js';
import type {
  DashboardMissionControlWorkflowCard,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowRailRow,
  DashboardWorkflowWorkItemRecord,
  DashboardWorkflowWorkspacePacket,
} from '../../lib/api.js';
import { WorkflowsRail } from './workflows-rail.js';
import {
  describeHeaderAddWorkLabel,
  type WorkflowWorkbenchScopeDescriptor,
  type WorkflowWorkbenchTab,
  type WorkflowsPageState,
} from './workflows-page.support.js';
import { WorkflowBoard } from './workflow-board.js';
import { WorkflowLaunchDialog } from './workflow-launch-dialog.js';
import {
  buildWorkflowWorkspaceSplitClassName,
  buildWorkflowWorkspaceSplitStyle,
  buildWorkflowsShellClassName,
  buildWorkflowsShellStyle,
} from './workflows-layout.js';
import { WorkflowStateStrip } from './workflow-state-strip.js';
import { WorkflowBottomWorkbench } from './workspace/workflow-bottom-workbench.js';
import { WorkflowAddWorkDialog } from './workspace/workflow-add-work-dialog.js';
import { WorkflowSteering } from './workspace/workflow-steering.js';

type WorkflowsPageViewProps = {
  activeTab: WorkflowWorkbenchTab;
  addWorkTargetWorkItemId: string | null;
  board: DashboardWorkflowWorkspacePacket['board'] | null;
  boardSelectionWorkItemId: string | null;
  deliverablesLimit: number;
  hasMoreRailRows: boolean;
  inputPackets: DashboardWorkflowInputPacketRecord[];
  isAddWorkOpen: boolean;
  isLaunchOpen: boolean;
  isRailHidden: boolean;
  isScopeLoading: boolean;
  isSteeringOpen: boolean;
  launchParameterDrafts: Record<string, string>;
  launchPlaybookId: string | null;
  launchWorkflowName: string | null;
  launchWorkspaceId: string | null;
  pageState: WorkflowsPageState;
  railLoading: boolean;
  railOngoingRows: DashboardWorkflowRailRow[];
  railRows: DashboardWorkflowRailRow[];
  railTotalCount: number | undefined;
  railVisibleCount: number | undefined;
  railWidthPx: number;
  repeatSourceWorkItemId: string | null;
  scopedWorkItemId: string | null;
  selectedScopeLabel: string | null;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
  selectedWorkflowRow: DashboardWorkflowRailRow | null;
  selectedWorkItemTasks: Record<string, unknown>[];
  steeringScope: WorkflowWorkbenchScopeDescriptor;
  steeringTargetWorkItemId: string | null;
  steeringWorkItem: DashboardWorkflowWorkItemRecord | null;
  tabScope: 'workflow' | 'selected_work_item';
  workbenchFraction: number;
  workbenchScope: WorkflowWorkbenchScopeDescriptor;
  workflow: DashboardMissionControlWorkflowCard | null;
  workflowParameters: Record<string, unknown> | null;
  workspacePacket: DashboardWorkflowWorkspacePacket | null;
  workspaceSplitRef: RefObject<HTMLDivElement>;
  workItemTitle: string | null;
  onAddWorkOpenChange(open: boolean): void;
  onBoardModeChange(boardMode: WorkflowsPageState['boardMode']): void;
  onClearWorkItemScope(): void;
  onCreateWorkflow(): void;
  onLaunched(workflowId: string): void;
  onLaunchOpenChange(open: boolean): void;
  onLoadMoreActivity(): void;
  onLoadMoreDeliverables(): void;
  onLoadMoreRail(): void;
  onNeedsActionOnlyChange(needsActionOnly: boolean): void;
  onOpenAddWork(workItemId: string | null | undefined): void;
  onLifecycleFilterChange(lifecycleFilter: 'all' | 'ongoing' | 'planned'): void;
  onRailModeChange(mode: WorkflowsPageState['mode']): void;
  onRailResizePointerDown(event: PointerEvent<HTMLButtonElement>): void;
  onSearchChange(search: string): void;
  onSelectWorkflow(workflowId: string): void;
  onSelectWorkItem(workItemId: string): void;
  onSteeringOpenChange(open: boolean): void;
  onSteeringRecorded(): void;
  onTabChange(tab: WorkflowWorkbenchTab): void;
  onToggleRail(): void;
  onWorkItemAction(input: {
    workItemId: string;
    action: 'needs-action' | 'steer' | 'repeat' | 'pause' | 'resume' | 'cancel';
  }): void;
  onWorkbenchResizePointerDown(event: PointerEvent<HTMLButtonElement>): void;
};

export function WorkflowsPageView(props: WorkflowsPageViewProps): JSX.Element {
  return (
    <>
      <div
        className={buildWorkflowsShellClassName(props.isRailHidden)}
        style={buildWorkflowsShellStyle(props.isRailHidden, props.railWidthPx)}
      >
        {!props.isRailHidden ? (
          <WorkflowsRail
            mode={props.pageState.mode}
            search={props.pageState.search}
            needsActionOnly={props.pageState.needsActionOnly}
            lifecycleFilter={props.pageState.lifecycleFilter}
            visibleCount={props.railVisibleCount}
            totalCount={props.railTotalCount}
            rows={props.railRows}
            ongoingRows={props.railOngoingRows}
            selectedWorkflowId={props.pageState.workflowId}
            selectedWorkflowRow={props.selectedWorkflowRow}
            hasNextPage={props.hasMoreRailRows}
            isLoading={props.railLoading}
            onModeChange={props.onRailModeChange}
            onLifecycleFilterChange={props.onLifecycleFilterChange}
            onSearchChange={props.onSearchChange}
            onNeedsActionOnlyChange={props.onNeedsActionOnlyChange}
            onSelectWorkflow={props.onSelectWorkflow}
            onLoadMore={props.onLoadMoreRail}
            onCreateWorkflow={props.onCreateWorkflow}
          />
        ) : null}
        {!props.isRailHidden ? (
          <div className="relative hidden lg:flex items-stretch justify-center">
            <button
              type="button"
              aria-label="Resize workflows rail"
              className="h-full w-full cursor-col-resize rounded-full bg-transparent transition-colors hover:bg-border/60"
              onPointerDown={props.onRailResizePointerDown}
            />
          </div>
        ) : null}
        <div className="grid min-h-0 w-full min-w-0 gap-3 lg:h-full lg:min-h-0 lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
          <section data-workflows-top-strip="true" className="grid shrink-0 gap-2.5 sm:gap-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <Button type="button" size="sm" variant="outline" onClick={props.onToggleRail}>
                {props.isRailHidden ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
                {props.isRailHidden ? 'Show workflows' : 'Hide workflows'}
              </Button>
              {props.isRailHidden ? (
                <Button type="button" size="sm" onClick={props.onCreateWorkflow}>
                  New Workflow
                </Button>
              ) : null}
            </div>
            {props.workflow && props.workspacePacket ? (
              <WorkflowStateStrip
                workflow={props.workflow}
                stickyStrip={props.workspacePacket.sticky_strip}
                board={props.board}
                selectedScopeLabel={props.selectedScopeLabel}
                addWorkLabel={describeHeaderAddWorkLabel({
                  scopeKind: props.tabScope,
                  lifecycle: props.workflow.lifecycle,
                })}
                onTabChange={props.onTabChange}
                onAddWork={() => props.onOpenAddWork(props.tabScope === 'selected_work_item' ? props.boardSelectionWorkItemId : null)}
              />
            ) : null}
          </section>

          {props.workflow && props.workspacePacket ? (
            <div
              ref={props.workspaceSplitRef}
              className={buildWorkflowWorkspaceSplitClassName()}
              style={buildWorkflowWorkspaceSplitStyle(props.workbenchFraction)}
            >
              <section
                data-workflows-board-frame="true"
                className="flex h-full min-h-[11rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[15rem] lg:min-h-0"
              >
                <WorkflowBoard
                  workflowId={props.workflow.id}
                  board={props.board}
                  workflowState={props.workflow.state}
                  selectedWorkItemId={props.boardSelectionWorkItemId}
                  boardMode={props.pageState.boardMode}
                  onBoardModeChange={props.onBoardModeChange}
                  onSelectWorkItem={props.onSelectWorkItem}
                  onWorkItemAction={props.onWorkItemAction}
                />
              </section>
              <div className="relative hidden lg:flex items-center justify-center">
                <button
                  type="button"
                  aria-label="Resize workflow workbench"
                  className="h-full w-full cursor-row-resize rounded-full bg-transparent transition-colors hover:bg-border/60"
                  onPointerDown={props.onWorkbenchResizePointerDown}
                />
              </div>
              <section
                data-workflows-workbench-frame="true"
                className="flex h-full min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[16rem] lg:min-h-0"
              >
                <WorkflowBottomWorkbench
                  workflowId={props.workflow.id}
                  workflow={props.workflow}
                  stickyStrip={props.workspacePacket.sticky_strip}
                  board={props.board}
                  workflowName={props.workflow.name}
                  packet={props.workspacePacket}
                  activeTab={props.activeTab}
                  selectedWorkItemId={props.boardSelectionWorkItemId}
                  scopedWorkItemId={props.scopedWorkItemId}
                  selectedWorkItemTitle={props.workItemTitle}
                  selectedWorkItem={props.selectedWorkItem}
                  selectedWorkItemTasks={props.selectedWorkItemTasks}
                  inputPackets={props.inputPackets}
                  workflowParameters={props.workflowParameters}
                  scope={props.workbenchScope}
                  isScopeLoading={props.isScopeLoading}
                  onTabChange={props.onTabChange}
                  onClearWorkItemScope={props.onClearWorkItemScope}
                  onOpenAddWork={props.onOpenAddWork}
                  onLoadMoreActivity={props.onLoadMoreActivity}
                  onLoadMoreDeliverables={props.onLoadMoreDeliverables}
                />
              </section>
            </div>
          ) : (
            <section
              data-workflows-workbench-frame="true"
              className="flex h-full min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[16rem] lg:min-h-0"
            >
              <EmptyWorkspaceState
                hasWorkflows={props.railRows.length + props.railOngoingRows.length > 0}
                onCreateWorkflow={props.onCreateWorkflow}
              />
            </section>
          )}
        </div>
      </div>

      <WorkflowLaunchDialog
        isOpen={props.isLaunchOpen}
        onOpenChange={props.onLaunchOpenChange}
        initialPlaybookId={props.launchPlaybookId}
        initialWorkspaceId={props.launchWorkspaceId}
        initialWorkflowName={props.launchWorkflowName}
        initialParameterDrafts={props.launchParameterDrafts}
        onLaunched={props.onLaunched}
      />
      {props.pageState.workflowId ? (
        <>
          <WorkflowAddWorkDialog
            isOpen={props.isAddWorkOpen}
            onOpenChange={props.onAddWorkOpenChange}
            workflowId={props.pageState.workflowId}
            lifecycle={props.workflow?.lifecycle}
            board={props.board}
            inputPackets={props.inputPackets}
            workItemId={props.addWorkTargetWorkItemId}
            prefillSourceWorkItemId={props.repeatSourceWorkItemId}
            workflowWorkspaceId={props.workflow?.workspaceId}
          />
          <Dialog open={props.isSteeringOpen} onOpenChange={props.onSteeringOpenChange}>
            <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Steer work item</DialogTitle>
                <DialogDescription>
                  Record guidance for the selected work item and wake the orchestrator on that scope.
                </DialogDescription>
              </DialogHeader>
              {props.workflow && props.workspacePacket && props.steeringWorkItem ? (
                <WorkflowSteering
                  workflowId={props.workflow.id}
                  workflowName={props.workflow.name}
                  workflowState={props.workflow.state}
                  boardColumns={props.board?.columns ?? []}
                  selectedWorkItemId={props.steeringWorkItem.id}
                  selectedWorkItemTitle={props.steeringWorkItem.title}
                  selectedWorkItem={props.steeringWorkItem}
                  scope={props.steeringScope}
                  interventions={props.workspacePacket.steering.recent_interventions}
                  messages={props.workspacePacket.steering.session.messages}
                  sessionId={props.workspacePacket.steering.session.session_id}
                  canAcceptRequest={props.workspacePacket.steering.steering_state.can_accept_request}
                  onRecorded={props.onSteeringRecorded}
                />
              ) : null}
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </>
  );
}

function EmptyWorkflowsState(props: { onCreateWorkflow(): void }): JSX.Element {
  return (
    <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center rounded-3xl border border-dashed border-border/70 bg-background/70 p-8">
      <div className="grid max-w-lg gap-4 text-center">
        <LayoutDashboard className="mx-auto h-10 w-10 text-muted-foreground" />
        <div className="grid gap-2">
          <p className="text-xl font-semibold text-foreground">No workflows yet</p>
          <p className="text-sm text-muted-foreground">
            Start the first workflow to populate the live rail and open the workflow workspace automatically.
          </p>
        </div>
        <div className="flex justify-center">
          <Button type="button" onClick={props.onCreateWorkflow}>
            New Workflow
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyWorkspaceState(props: {
  hasWorkflows: boolean;
  onCreateWorkflow(): void;
}): JSX.Element {
  if (!props.hasWorkflows) {
    return <EmptyWorkflowsState onCreateWorkflow={props.onCreateWorkflow} />;
  }

  return (
    <div className="flex min-h-[28rem] items-center justify-center rounded-3xl border border-dashed border-border/70 bg-background/70 p-8">
      <div className="grid max-w-lg gap-3 text-center">
        <LayoutDashboard className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="text-lg font-semibold text-foreground">Select a workflow</p>
        <p className="text-sm text-muted-foreground">
          Choose a workflow from the left rail to open its board, details, needs action, live
          console, and deliverables in one place.
        </p>
      </div>
    </div>
  );
}
