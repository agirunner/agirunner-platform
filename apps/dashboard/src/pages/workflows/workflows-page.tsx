import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/button.js';
import {
  dashboardApi,
  type DashboardMissionControlWorkflowCard,
  type DashboardWorkflowRailRow,
  type DashboardWorkflowWorkspacePacket,
} from '../../lib/api.js';
import { WorkflowsRail } from './workflows-rail.js';
import {
  buildWorkflowsPageSearchParams,
  buildWorkflowsPageHref,
  describeWorkflowWorkbenchScope,
  readWorkflowsPageState,
  resolveSelectedWorkflowId,
  resolveWorkspacePlaceholderData,
  resolveWorkflowTabScope,
  type WorkflowsPageState,
} from './workflows-page.support.js';
import {
  readStoredWorkflowBoardLens,
  readStoredWorkflowId,
  readStoredWorkflowRailHidden,
  readStoredWorkflowRailWidth,
  readStoredWorkflowWorkbenchFraction,
  writeStoredWorkflowBoardLens,
  writeStoredWorkflowId,
  writeStoredWorkflowRailHidden,
  writeStoredWorkflowRailWidth,
  writeStoredWorkflowWorkbenchFraction,
} from './workflows-page.storage.js';
import { buildWorkflowRailQueryKey, buildWorkflowWorkspaceQueryKey } from './workflows-query.js';
import { useWorkflowRailRealtime, useWorkflowWorkspaceRealtime } from './workflows-realtime.js';
import { WorkflowBoard } from './workflow-board.js';
import { WorkflowLaunchDialog } from './workflow-launch-dialog.js';
import {
  buildWorkflowWorkspaceSplitStyle,
  buildWorkflowsShellClassName,
  buildWorkflowsShellStyle,
  clampWorkflowRailWidthPx,
  clampWorkflowWorkbenchFraction,
  DEFAULT_WORKFLOW_RAIL_WIDTH_PX,
  DEFAULT_WORKFLOW_WORKBENCH_FRACTION,
} from './workflows-layout.js';
import { WorkflowStateStrip } from './workflow-state-strip.js';
import { WorkflowBottomWorkbench } from './workspace/workflow-bottom-workbench.js';
import { WorkflowAddWorkDialog } from './workspace/workflow-add-work-dialog.js';
import { WorkflowRedriveDialog } from './workspace/workflow-redrive-dialog.js';

const RAIL_PAGE_SIZE = 100;
const ACTIVITY_PAGE_SIZE = 50;
const DELIVERABLES_PAGE_SIZE = 12;

export function WorkflowsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const pageState = useMemo(
    () => readWorkflowsPageState(location.pathname, searchParams),
    [location.pathname, searchParams],
  );
  const [railLimit, setRailLimit] = useState(RAIL_PAGE_SIZE);
  const [activityLimit, setActivityLimit] = useState(ACTIVITY_PAGE_SIZE);
  const [deliverablesLimit, setDeliverablesLimit] = useState(DELIVERABLES_PAGE_SIZE);
  const [isLaunchOpen, setIsLaunchOpen] = useState(false);
  const [isAddWorkOpen, setIsAddWorkOpen] = useState(false);
  const [isRedriveOpen, setIsRedriveOpen] = useState(false);
  const [isRailHidden, setIsRailHidden] = useState(readStoredWorkflowRailHidden());
  const [railWidthPx, setRailWidthPx] = useState(
    clampWorkflowRailWidthPx(readStoredWorkflowRailWidth() ?? DEFAULT_WORKFLOW_RAIL_WIDTH_PX),
  );
  const [boardLens, setBoardLens] = useState<'work_items' | 'tasks'>(
    readStoredWorkflowBoardLens() ?? 'work_items',
  );
  const [workbenchFraction, setWorkbenchFraction] = useState(
    clampWorkflowWorkbenchFraction(
      readStoredWorkflowWorkbenchFraction() ?? DEFAULT_WORKFLOW_WORKBENCH_FRACTION,
    ),
  );
  const lastWorkspacePacketRef = useRef<DashboardWorkflowWorkspacePacket | null>(null);
  const workspaceSplitRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRailLimit(RAIL_PAGE_SIZE);
  }, [pageState.mode, pageState.needsActionOnly, pageState.ongoingOnly, pageState.search]);

  useEffect(() => {
    setActivityLimit(ACTIVITY_PAGE_SIZE);
    setDeliverablesLimit(DELIVERABLES_PAGE_SIZE);
  }, [pageState.workflowId, pageState.workItemId]);

  useEffect(() => {
    writeStoredWorkflowRailHidden(isRailHidden);
  }, [isRailHidden]);
  useEffect(() => {
    writeStoredWorkflowRailWidth(railWidthPx);
  }, [railWidthPx]);
  useEffect(() => {
    writeStoredWorkflowBoardLens(boardLens);
  }, [boardLens]);
  useEffect(() => {
    writeStoredWorkflowWorkbenchFraction(workbenchFraction);
  }, [workbenchFraction]);

  const activeTab = pageState.tab ?? 'details';
  const tabScope = resolveWorkflowTabScope(activeTab, pageState.workItemId, pageState.taskId);
  const scopedWorkItemId = tabScope === 'selected_work_item' || tabScope === 'selected_task'
    ? pageState.workItemId
    : null;
  const scopedTaskId = tabScope === 'selected_task' ? pageState.taskId : null;
  const requestedWorkspaceScope = {
    workflowId: pageState.workflowId,
    scopeKind: tabScope,
    workItemId: scopedWorkItemId,
    taskId: scopedTaskId,
  };

  const railQuery = useQuery({
    queryKey: [...buildWorkflowRailQueryKey(pageState), railLimit],
    queryFn: () =>
      dashboardApi.getWorkflowRail({
        mode: pageState.mode,
        perPage: railLimit,
        needsActionOnly: pageState.needsActionOnly,
        ongoingOnly: pageState.ongoingOnly,
        search: pageState.search,
        workflowId: pageState.workflowId ?? undefined,
      }),
  });
  const workspaceQuery = useQuery({
    queryKey: pageState.workflowId
      ? buildWorkflowWorkspaceQueryKey({
          workflowId: pageState.workflowId,
          workItemId: scopedWorkItemId,
          taskId: scopedTaskId,
          scopeKind: tabScope,
          boardMode: pageState.boardMode,
          activityLimit,
          deliverablesLimit,
        })
      : ['workflows', 'workspace', 'none'],
    queryFn: () =>
      dashboardApi.getWorkflowWorkspace(pageState.workflowId as string, {
        workItemId: scopedWorkItemId ?? undefined,
        taskId: scopedTaskId ?? undefined,
        tabScope,
        boardMode: pageState.boardMode,
        liveConsoleLimit: activityLimit,
        historyLimit: activityLimit,
        deliverablesLimit,
      }),
    enabled: Boolean(pageState.workflowId),
    placeholderData: (previous) =>
      resolveWorkspacePlaceholderData(previous, requestedWorkspaceScope),
  });
  const inputPacketsQuery = useQuery({
    queryKey: ['workflows', 'input-packets', pageState.workflowId],
    queryFn: () => dashboardApi.listWorkflowInputPackets(pageState.workflowId as string),
    enabled: Boolean(pageState.workflowId),
  });
  const workflowDetailQuery = useQuery({
    queryKey: ['workflows', 'detail', pageState.workflowId],
    queryFn: () => dashboardApi.getWorkflow(pageState.workflowId as string),
    enabled: Boolean(pageState.workflowId),
  });
  const selectedWorkItemQuery = useQuery({
    queryKey: ['workflows', 'work-item-detail', pageState.workflowId, pageState.workItemId],
    queryFn: () =>
      dashboardApi.getWorkflowWorkItem(pageState.workflowId as string, pageState.workItemId as string),
    enabled: Boolean(pageState.workflowId && pageState.workItemId),
  });
  const selectedWorkItemTasksQuery = useQuery({
    queryKey: ['workflows', 'work-item-tasks', pageState.workflowId, pageState.workItemId],
    queryFn: () =>
      dashboardApi.listWorkflowWorkItemTasks(pageState.workflowId as string, pageState.workItemId as string),
    enabled: Boolean(pageState.workflowId && pageState.workItemId),
  });
  const selectedTaskQuery = useQuery({
    queryKey: ['tasks', pageState.taskId],
    queryFn: () => dashboardApi.getTask(pageState.taskId as string),
    enabled: Boolean(pageState.taskId),
  });
  const workflowSettingsQuery = useQuery({
    queryKey: ['workflow-settings', pageState.workflowId],
    queryFn: () => dashboardApi.getWorkflowSettings(pageState.workflowId as string),
    enabled: Boolean(pageState.workflowId),
  });

  useWorkflowRailRealtime(queryClient, {
    mode: pageState.mode,
    search: pageState.search,
    needsActionOnly: pageState.needsActionOnly,
    ongoingOnly: pageState.ongoingOnly,
    workflowId: pageState.workflowId,
  });
  useWorkflowWorkspaceRealtime(queryClient, {
    workflowId: pageState.workflowId,
    workItemId: scopedWorkItemId,
    taskId: scopedTaskId,
    tabScope,
    boardMode: pageState.boardMode,
  });

  useEffect(() => {
    if (!pageState.workflowId) {
      lastWorkspacePacketRef.current = null;
      return;
    }
    if (workspaceQuery.isPlaceholderData) {
      return;
    }
    if (workspaceQuery.data?.workflow?.id === pageState.workflowId) {
      lastWorkspacePacketRef.current = workspaceQuery.data;
    }
  }, [pageState.workflowId, workspaceQuery.data, workspaceQuery.isPlaceholderData]);

  const railPacket = railQuery.data ?? null;
  const workspacePacket = workspaceQuery.data
    ?? resolveWorkspacePlaceholderData(
      lastWorkspacePacketRef.current ?? undefined,
      requestedWorkspaceScope,
    )
    ?? null;
  const workflow = workspacePacket?.workflow ?? null;
  const board = workspacePacket?.board ?? null;
  const selectedWorkflowRow = useMemo(
    () => deriveSelectedWorkflowRow(railPacket?.rows ?? [], railPacket?.ongoing_rows ?? [], pageState.workflowId, workflow),
    [pageState.workflowId, railPacket?.ongoing_rows, railPacket?.rows, workflow],
  );
  const workItemTitle = useMemo(
    () =>
      selectedWorkItemQuery.data?.title
      ?? board?.work_items.find((item) => item.id === pageState.workItemId)?.title
      ?? null,
    [board, pageState.workItemId, selectedWorkItemQuery.data?.title],
  );
  const taskTitle = useMemo(() => {
    if (selectedTaskQuery.data?.title) {
      return selectedTaskQuery.data.title;
    }
    if (!pageState.taskId) {
      return null;
    }
    const matchingTask = (selectedWorkItemTasksQuery.data ?? []).find(
      (task) => typeof task.id === 'string' && task.id === pageState.taskId,
    );
    return typeof matchingTask?.title === 'string' ? matchingTask.title : null;
  }, [pageState.taskId, selectedTaskQuery.data?.title, selectedWorkItemTasksQuery.data]);
  const selectedScopeLabel = pageState.taskId
    ? taskTitle ?? pageState.taskId
    : scopedWorkItemId
      ? workItemTitle ?? scopedWorkItemId
      : null;
  const workbenchScope = useMemo(
    () =>
      describeWorkflowWorkbenchScope({
        scopeKind: workspacePacket?.bottom_tabs.current_scope_kind ?? requestedWorkspaceScope.scopeKind,
        workflowName: workflow?.name ?? pageState.workflowId,
        workItemId: workspacePacket?.bottom_tabs.current_work_item_id ?? requestedWorkspaceScope.workItemId,
        workItemTitle,
        taskId: workspacePacket?.bottom_tabs.current_task_id ?? requestedWorkspaceScope.taskId,
        taskTitle,
      }),
    [
      pageState.workflowId,
      requestedWorkspaceScope.scopeKind,
      requestedWorkspaceScope.taskId,
      requestedWorkspaceScope.workItemId,
      taskTitle,
      workItemTitle,
      workflow?.name,
      workspacePacket?.bottom_tabs.current_scope_kind,
      workspacePacket?.bottom_tabs.current_task_id,
      workspacePacket?.bottom_tabs.current_work_item_id,
    ],
  );
  const hasMoreRailRows = Boolean(railPacket?.next_cursor) || (railPacket?.rows.length ?? 0) >= railLimit;

  useEffect(() => {
    if (!railPacket || pageState.workflowId) {
      return;
    }
    const selectableRows = [...railPacket.rows, ...railPacket.ongoing_rows];
    if (selectableRows.length === 0) {
      return;
    }
    const nextWorkflowId = resolveSelectedWorkflowId({
      currentWorkflowId: pageState.workflowId,
      rows: selectableRows,
      selectedWorkflowId: railPacket.selected_workflow_id,
      storedWorkflowId: readStoredWorkflowId(),
    });
    if (!nextWorkflowId) {
      return;
    }
    patchPageState(navigate, pageState, {
      workflowId: nextWorkflowId,
    });
  }, [navigate, pageState, railPacket]);

  useEffect(() => {
    if (!pageState.workflowId) {
      return;
    }
    writeStoredWorkflowId(pageState.workflowId);
  }, [pageState.workflowId]);

  return (
    <>
      <div
        className={buildWorkflowsShellClassName(isRailHidden)}
        style={buildWorkflowsShellStyle(isRailHidden, railWidthPx)}
      >
        {!isRailHidden ? (
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-stone-50/90 lg:min-h-0 dark:bg-slate-950/70">
            <WorkflowsRail
              mode={pageState.mode}
              search={pageState.search}
              needsActionOnly={pageState.needsActionOnly}
              ongoingOnly={pageState.ongoingOnly}
              rows={railPacket?.rows ?? []}
              ongoingRows={railPacket?.ongoing_rows ?? []}
              selectedWorkflowId={pageState.workflowId}
              selectedWorkflowRow={selectedWorkflowRow}
              hasNextPage={hasMoreRailRows}
              isLoading={railQuery.isLoading}
              onModeChange={(mode) => patchPageState(navigate, pageState, { mode, tab: null })}
              onSearchChange={(search) => patchPageState(navigate, pageState, { search })}
              onNeedsActionOnlyChange={(needsActionOnly) =>
                patchPageState(navigate, pageState, { needsActionOnly })
              }
              onShowAllOngoing={() =>
                patchPageState(navigate, pageState, { ongoingOnly: true })
              }
              onClearOngoingFilter={() =>
                patchPageState(navigate, pageState, { ongoingOnly: false })
              }
              onSelectWorkflow={(workflowId) =>
                patchPageState(navigate, pageState, { workflowId, workItemId: null, taskId: null })
              }
              onLoadMore={() => setRailLimit((current) => current + RAIL_PAGE_SIZE)}
              onCreateWorkflow={() => setIsLaunchOpen(true)}
            />
          </div>
        ) : null}
        {!isRailHidden ? (
          <div className="relative hidden lg:flex items-stretch justify-center">
            <button
              type="button"
              aria-label="Resize workflows rail"
              className="h-full w-full cursor-col-resize rounded-full bg-transparent transition-colors hover:bg-border/60"
              onPointerDown={(event) => {
                event.preventDefault();
                const startX = event.clientX;
                const startWidth = railWidthPx;
                const handlePointerMove = (moveEvent: PointerEvent) => {
                  const delta = moveEvent.clientX - startX;
                  setRailWidthPx(clampWorkflowRailWidthPx(startWidth + delta));
                };
                const handlePointerUp = () => {
                  window.removeEventListener('pointermove', handlePointerMove);
                  window.removeEventListener('pointerup', handlePointerUp);
                };
                window.addEventListener('pointermove', handlePointerMove);
                window.addEventListener('pointerup', handlePointerUp);
              }}
            />
          </div>
        ) : null}
        <div className="grid min-h-0 w-full min-w-0 gap-2 lg:h-full lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setIsRailHidden((current) => !current)}>
              {isRailHidden ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              {isRailHidden ? 'Show workflows' : 'Hide workflows'}
            </Button>
            {isRailHidden ? (
              <Button type="button" size="sm" onClick={() => setIsLaunchOpen(true)}>
                New Workflow
              </Button>
            ) : null}
          </div>

          {workflow && workspacePacket ? (
            <div className="grid min-h-0 gap-2 lg:grid-rows-[auto_minmax(0,1fr)]">
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
                <WorkflowStateStrip
                  workflow={workflow}
                  stickyStrip={workspacePacket.sticky_strip}
                  workflowSettings={workflowSettingsQuery.data ?? null}
                  board={board}
                  selectedScopeLabel={selectedScopeLabel}
                  onTabChange={(tab) => patchPageState(navigate, pageState, { tab })}
                  onAddWork={() => setIsAddWorkOpen(true)}
                  onOpenRedrive={() => setIsRedriveOpen(true)}
                  onVisibilityModeChange={async (nextMode) => {
                    const currentSettings = workflowSettingsQuery.data;
                    if (!currentSettings) {
                      return;
                    }
                    await dashboardApi.updateWorkflowSettings(pageState.workflowId as string, {
                      live_visibility_mode: nextMode,
                      settings_revision: currentSettings.revision,
                    });
                    await queryClient.invalidateQueries({
                      queryKey: ['workflow-settings', pageState.workflowId],
                    });
                  }}
                />
              </div>
              <div
                ref={workspaceSplitRef}
                className="grid min-h-0 gap-2 lg:h-full lg:gap-0 lg:overflow-hidden"
                style={buildWorkflowWorkspaceSplitStyle(workbenchFraction)}
              >
                <div className="min-h-0 overflow-hidden">
                  <WorkflowBoard
                    workflowId={workflow.id}
                    board={board}
                    workflowState={workflow.state}
                    selectedWorkItemId={pageState.workItemId}
                    selectedTaskId={pageState.taskId}
                    boardLens={boardLens}
                    boardMode={pageState.boardMode}
                    onBoardLensChange={setBoardLens}
                    onBoardModeChange={(boardMode) =>
                      patchPageState(navigate, pageState, { boardMode })
                    }
                    onSelectWorkItem={(workItemId) =>
                      patchPageState(navigate, pageState, { workItemId, taskId: null })
                    }
                    onSelectTask={(workItemId, taskId) =>
                      patchPageState(navigate, pageState, { workItemId, taskId })
                    }
                  />
                </div>
                <div className="relative hidden lg:flex items-center justify-center">
                  <button
                    type="button"
                    aria-label="Resize workflow workbench"
                    className="h-full w-full cursor-row-resize rounded-full bg-transparent transition-colors hover:bg-border/60"
                    onPointerDown={(event) => {
                      const splitContainer = workspaceSplitRef.current;
                      if (!splitContainer) {
                        return;
                      }
                      event.preventDefault();
                      const startY = event.clientY;
                      const startFraction = workbenchFraction;
                      const containerHeight = splitContainer.getBoundingClientRect().height;
                      const handlePointerMove = (moveEvent: PointerEvent) => {
                        const delta = moveEvent.clientY - startY;
                        const nextFraction = clampWorkflowWorkbenchFraction(
                          startFraction - (delta / Math.max(containerHeight, 1)),
                        );
                        setWorkbenchFraction(nextFraction);
                      };
                      const handlePointerUp = () => {
                        window.removeEventListener('pointermove', handlePointerMove);
                        window.removeEventListener('pointerup', handlePointerUp);
                      };
                      window.addEventListener('pointermove', handlePointerMove);
                      window.addEventListener('pointerup', handlePointerUp);
                    }}
                  />
                </div>
                <div className="min-h-0 overflow-hidden">
                  <WorkflowBottomWorkbench
                    workflowId={workflow.id}
                    workflow={workflow}
                    stickyStrip={workspacePacket.sticky_strip}
                    board={board}
                    workflowName={workflow.name}
                    packet={workspacePacket}
                    activeTab={activeTab}
                    selectedWorkItemId={pageState.workItemId}
                    scopedWorkItemId={scopedWorkItemId}
                    selectedWorkItemTitle={workItemTitle}
                    selectedTaskId={pageState.taskId}
                    selectedTaskTitle={taskTitle}
                    selectedWorkItem={selectedWorkItemQuery.data ?? null}
                    selectedTask={selectedTaskQuery.data ?? null}
                    selectedWorkItemTasks={selectedWorkItemTasksQuery.data ?? []}
                    inputPackets={inputPacketsQuery.data ?? []}
                    workflowParameters={(workflowDetailQuery.data?.parameters as Record<string, unknown> | null | undefined) ?? null}
                    scope={workbenchScope}
                    onTabChange={(tab) => patchPageState(navigate, pageState, { tab })}
                    onClearWorkItemScope={() =>
                      patchPageState(navigate, pageState, { workItemId: null, taskId: null })
                    }
                    onClearTaskScope={() => patchPageState(navigate, pageState, { taskId: null })}
                    onOpenAddWork={(workItemId) => {
                      if (workItemId !== undefined) {
                        patchPageState(navigate, pageState, { workItemId: workItemId ?? null, taskId: null });
                      }
                      setIsAddWorkOpen(true);
                    }}
                    onOpenRedrive={() => setIsRedriveOpen(true)}
                    onLoadMoreActivity={() =>
                      setActivityLimit((current) => current + ACTIVITY_PAGE_SIZE)
                    }
                    onLoadMoreDeliverables={() =>
                      setDeliverablesLimit((current) => current + DELIVERABLES_PAGE_SIZE)
                    }
                  />
                </div>
              </div>
            </div>
          ) : (
            <EmptyWorkspaceState
              hasWorkflows={((railPacket?.rows.length ?? 0) + (railPacket?.ongoing_rows.length ?? 0)) > 0}
              onCreateWorkflow={() => setIsLaunchOpen(true)}
            />
          )}
        </div>
      </div>

      <WorkflowLaunchDialog
        isOpen={isLaunchOpen}
        onOpenChange={setIsLaunchOpen}
        onLaunched={(workflowId) =>
          patchPageState(navigate, pageState, {
            workflowId,
            workItemId: null,
            taskId: null,
            tab: null,
          })
        }
      />
      {pageState.workflowId ? (
        <>
          <WorkflowAddWorkDialog
            isOpen={isAddWorkOpen}
            onOpenChange={setIsAddWorkOpen}
            workflowId={pageState.workflowId}
            lifecycle={workflow?.lifecycle}
            board={board}
            workItemId={pageState.workItemId}
          />
          <WorkflowRedriveDialog
            isOpen={isRedriveOpen}
            onOpenChange={setIsRedriveOpen}
            workflowId={pageState.workflowId}
            workflowName={workflow?.name ?? 'Workflow'}
            workspaceId={workflow?.workspaceId}
            onRedriven={(workflowId) =>
              patchPageState(navigate, pageState, {
                workflowId,
                workItemId: null,
                taskId: null,
                tab: null,
              })
            }
          />
        </>
      ) : null}
    </>
  );
}

function deriveSelectedWorkflowRow(
  rows: DashboardWorkflowRailRow[],
  ongoingRows: DashboardWorkflowRailRow[],
  workflowId: string | null,
  workflow: DashboardMissionControlWorkflowCard | null,
): DashboardWorkflowRailRow | null {
  if (!workflowId) {
    return null;
  }
  const visibleRow = [...rows, ...ongoingRows].find((row) => row.workflow_id === workflowId);
  if (visibleRow) {
    return visibleRow;
  }
  if (!workflow) {
    return null;
  }
  return {
    workflow_id: workflow.id,
    name: workflow.name,
    state: workflow.state ?? null,
    lifecycle: workflow.lifecycle ?? null,
    current_stage: workflow.currentStage ?? null,
    workspace_name: workflow.workspaceName ?? null,
    playbook_name: workflow.playbookName ?? null,
    posture: workflow.posture ?? null,
    live_summary: workflow.pulse.summary,
    last_changed_at: workflow.metrics.lastChangedAt ?? workflow.pulse.updatedAt ?? null,
    needs_action:
      workflow.attentionLane === 'needs_decision'
      || workflow.attentionLane === 'needs_intervention'
      || workflow.posture === 'needs_decision'
      || workflow.posture === 'needs_intervention'
      || workflow.posture === 'recoverable_needs_steering'
      || workflow.posture === 'terminal_failed',
    counts: {
      active_task_count: workflow.metrics.activeTaskCount,
      active_work_item_count: workflow.metrics.activeWorkItemCount,
      blocked_work_item_count: workflow.metrics.blockedWorkItemCount,
      open_escalation_count: workflow.metrics.openEscalationCount,
      waiting_for_decision_count: workflow.metrics.waitingForDecisionCount,
      failed_task_count: workflow.metrics.failedTaskCount,
    },
  };
}

function EmptyWorkflowsState(props: {
  onCreateWorkflow(): void;
}): JSX.Element {
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
          Choose a workflow from the left rail to open its board, steering, history, live console,
          and deliverables in one place.
        </p>
      </div>
    </div>
  );
}

function patchPageState(
  navigate: ReturnType<typeof useNavigate>,
  currentState: WorkflowsPageState,
  patch: Partial<WorkflowsPageState>,
): void {
  const currentHref = buildWorkflowsPageHref({}, currentState);
  const nextHref = buildWorkflowsPageHref(patch, currentState);
  if (nextHref === currentHref) {
    return;
  }
  navigate(nextHref, {
    replace: true,
  });
}
