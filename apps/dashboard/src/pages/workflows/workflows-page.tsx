import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Button } from '../../components/ui/button.js';
import {
  dashboardApi,
  type DashboardTaskRecord,
  type DashboardMissionControlWorkflowCard,
  type DashboardWorkflowRailRow,
  type DashboardWorkflowWorkspacePacket,
} from '../../lib/api.js';
import { WorkflowsRail } from './workflows-rail.js';
import {
  describeHeaderAddWorkLabel,
  buildWorkflowsPageSearchParams,
  buildWorkflowsPageHref,
  describeWorkflowWorkbenchScope,
  readWorkflowsPageState,
  readWorkflowLaunchRequest,
  resolveHeaderAddWorkTargetWorkItemId,
  resolveSelectedWorkflowId,
  workspacePacketMatchesScope,
  resolveWorkspacePlaceholderData,
  resolveWorkflowTabScope,
  type WorkflowsPageState,
} from './workflows-page.support.js';
import {
  readStoredWorkflowId,
  readStoredWorkflowRailHidden,
  readStoredWorkflowRailWidth,
  readStoredWorkflowWorkbenchFraction,
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
  buildWorkflowWorkspaceSplitClassName,
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
import { WorkflowSteering } from './workspace/workflow-steering.js';

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
  const launchRequest = useMemo(
    () => readWorkflowLaunchRequest(searchParams),
    [searchParams],
  );
  const [railLimit, setRailLimit] = useState(RAIL_PAGE_SIZE);
  const [activityLimit, setActivityLimit] = useState(ACTIVITY_PAGE_SIZE);
  const [deliverablesLimit, setDeliverablesLimit] = useState(DELIVERABLES_PAGE_SIZE);
  const [isLaunchOpen, setIsLaunchOpen] = useState(false);
  const [launchPlaybookId, setLaunchPlaybookId] = useState<string | null>(null);
  const [isAddWorkOpen, setIsAddWorkOpen] = useState(false);
  const [addWorkTargetWorkItemId, setAddWorkTargetWorkItemId] = useState<string | null>(null);
  const [repeatSourceWorkItemId, setRepeatSourceWorkItemId] = useState<string | null>(null);
  const [isSteeringOpen, setIsSteeringOpen] = useState(false);
  const [steeringTargetWorkItemId, setSteeringTargetWorkItemId] = useState<string | null>(null);
  const [isRailHidden, setIsRailHidden] = useState(readStoredWorkflowRailHidden());
  const [railWidthPx, setRailWidthPx] = useState(
    clampWorkflowRailWidthPx(readStoredWorkflowRailWidth() ?? DEFAULT_WORKFLOW_RAIL_WIDTH_PX),
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
    if (!launchRequest.isRequested) {
      return;
    }
    setLaunchPlaybookId(launchRequest.playbookId);
    setIsLaunchOpen(true);
    navigate(buildWorkflowsPageHref({}, pageState), { replace: true });
  }, [launchRequest.isRequested, launchRequest.playbookId, navigate, pageState]);

  useEffect(() => {
    writeStoredWorkflowRailHidden(isRailHidden);
  }, [isRailHidden]);
  useEffect(() => {
    writeStoredWorkflowRailWidth(railWidthPx);
  }, [railWidthPx]);
  useEffect(() => {
    writeStoredWorkflowWorkbenchFraction(workbenchFraction);
  }, [workbenchFraction]);

  const handleSelectWorkItem = (workItemId: string) => {
    patchPageState(navigate, pageState, { workItemId, tab: 'details' });
  };

  const handleClearWorkItemScope = () => {
    patchPageState(navigate, pageState, { workItemId: null });
  };

  const refreshWorkflowQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: ['workflows'] });
  };

  const handleWorkItemLifecycleAction = async (
    workItemId: string,
    action: 'pause' | 'resume' | 'cancel',
  ) => {
    patchPageState(navigate, pageState, { workItemId });
    if (!pageState.workflowId) {
      return;
    }
    if (action === 'pause') {
      await dashboardApi.pauseWorkflowWorkItem(pageState.workflowId, workItemId);
    } else if (action === 'resume') {
      await dashboardApi.resumeWorkflowWorkItem(pageState.workflowId, workItemId);
    } else {
      await dashboardApi.cancelWorkflowWorkItem(pageState.workflowId, workItemId);
    }
    await refreshWorkflowQueries();
  };

  const boardSelection = useMemo(
    () => ({
      workItemId: pageState.workItemId,
    }),
    [pageState.workItemId],
  );
  const activeTab = pageState.tab ?? 'details';
  const tabScope = resolveWorkflowTabScope(activeTab, boardSelection.workItemId);
  const scopedWorkItemId = tabScope === 'selected_work_item' ? boardSelection.workItemId : null;
  const requestedWorkspaceScope = {
    workflowId: pageState.workflowId,
    scopeKind: tabScope,
    workItemId: scopedWorkItemId,
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
      }),
  });
  const workspaceQuery = useQuery({
    queryKey: pageState.workflowId
      ? buildWorkflowWorkspaceQueryKey({
          workflowId: pageState.workflowId,
          workItemId: scopedWorkItemId,
          scopeKind: tabScope,
          boardMode: pageState.boardMode,
          activityLimit,
          deliverablesLimit,
        })
      : ['workflows', 'workspace', 'none'],
    queryFn: () =>
      dashboardApi.getWorkflowWorkspace(pageState.workflowId as string, {
        workItemId: scopedWorkItemId ?? undefined,
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
    queryKey: ['workflows', 'work-item-detail', pageState.workflowId, boardSelection.workItemId],
    queryFn: () =>
      dashboardApi.getWorkflowWorkItem(pageState.workflowId as string, boardSelection.workItemId as string),
    enabled: Boolean(pageState.workflowId && boardSelection.workItemId),
  });
  const selectedWorkItemTasksQuery = useQuery({
    queryKey: ['workflows', 'work-item-tasks', pageState.workflowId, boardSelection.workItemId],
    queryFn: () =>
      dashboardApi.listWorkflowWorkItemTasks(pageState.workflowId as string, boardSelection.workItemId as string),
    enabled: Boolean(pageState.workflowId && boardSelection.workItemId),
  });
  useWorkflowRailRealtime(queryClient, {
    mode: pageState.mode,
    search: pageState.search,
    needsActionOnly: pageState.needsActionOnly,
    ongoingOnly: pageState.ongoingOnly,
  });
  useWorkflowWorkspaceRealtime(queryClient, {
    workflowId: pageState.workflowId,
    workItemId: scopedWorkItemId,
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
  const isScopeLoading =
    workspaceQuery.isPlaceholderData &&
    lastWorkspacePacketRef.current !== null &&
    !workspacePacketMatchesScope(lastWorkspacePacketRef.current, requestedWorkspaceScope);
  const workflow = workspacePacket?.workflow ?? null;
  const board = workspacePacket?.board ?? null;
  const selectedWorkflowRow = useMemo(
    () => deriveSelectedWorkflowRow(railPacket?.rows ?? [], railPacket?.ongoing_rows ?? [], pageState.workflowId, workflow),
    [pageState.workflowId, railPacket?.ongoing_rows, railPacket?.rows, workflow],
  );
  const workItemTitle = useMemo(
    () =>
      selectedWorkItemQuery.data?.title
      ?? board?.work_items.find((item) => item.id === boardSelection.workItemId)?.title
      ?? null,
    [board, boardSelection.workItemId, selectedWorkItemQuery.data?.title],
  );
  const selectedScopeLabel = scopedWorkItemId ? workItemTitle ?? scopedWorkItemId : null;
  const selectedWorkItem =
    selectedWorkItemQuery.data
    ?? board?.work_items.find((item) => item.id === boardSelection.workItemId)
    ?? null;
  const selectedWorkItemTasks = selectedWorkItemTasksQuery.data ?? [];
  const selectedWorkItemTaskRecords = selectedWorkItemTasks as unknown as DashboardTaskRecord[];
  const currentWorkbenchScopeKind =
    workspacePacket?.bottom_tabs.current_scope_kind === 'selected_task'
      ? 'selected_work_item'
      : workspacePacket?.bottom_tabs.current_scope_kind ?? requestedWorkspaceScope.scopeKind;
  const workbenchScope = useMemo(
    () =>
      describeWorkflowWorkbenchScope({
        scopeKind: currentWorkbenchScopeKind,
        workflowName: workflow?.name ?? pageState.workflowId,
        workItemId: workspacePacket?.bottom_tabs.current_work_item_id ?? requestedWorkspaceScope.workItemId,
        workItemTitle,
      }),
    [
      currentWorkbenchScopeKind,
      pageState.workflowId,
      requestedWorkspaceScope.workItemId,
      workItemTitle,
      workflow?.name,
      workspacePacket?.bottom_tabs.current_work_item_id,
    ],
  );
  const steeringWorkItem =
    selectedWorkItem?.id === steeringTargetWorkItemId
      ? selectedWorkItem
      : board?.work_items.find((item) => item.id === steeringTargetWorkItemId) ?? null;
  const steeringScope = useMemo(
    () =>
      steeringWorkItem
        ? describeWorkflowWorkbenchScope({
            scopeKind: 'selected_work_item',
            workflowName: workflow?.name ?? pageState.workflowId,
            workItemId: steeringWorkItem.id,
            workItemTitle: steeringWorkItem.title,
          })
        : workbenchScope,
    [pageState.workflowId, steeringWorkItem, workbenchScope, workflow?.name],
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
    if (!railPacket || !pageState.workflowId) {
      return;
    }
    const selectableRows = [...railPacket.rows, ...railPacket.ongoing_rows];
    if (selectableRows.some((row) => row.workflow_id === pageState.workflowId)) {
      return;
    }
    if (selectedWorkflowRow && !workspaceQuery.isError && !workflowDetailQuery.isError) {
      return;
    }
    const nextWorkflowId = resolveSelectedWorkflowId({
      currentWorkflowId: null,
      rows: selectableRows,
      selectedWorkflowId: railPacket.selected_workflow_id,
      storedWorkflowId: readStoredWorkflowId(),
    });
    patchPageState(navigate, pageState, {
      workflowId: nextWorkflowId,
      workItemId: null,
      tab: null,
    });
  }, [
    navigate,
    pageState,
    railPacket,
    selectedWorkflowRow,
    workflowDetailQuery.isError,
    workspaceQuery.isError,
  ]);

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
          <WorkflowsRail
            mode={pageState.mode}
            search={pageState.search}
            needsActionOnly={pageState.needsActionOnly}
            ongoingOnly={pageState.ongoingOnly}
            visibleCount={railPacket?.visible_count}
            totalCount={railPacket?.total_count}
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
              patchPageState(navigate, pageState, { workflowId, workItemId: null })
            }
            onLoadMore={() => setRailLimit((current) => current + RAIL_PAGE_SIZE)}
            onCreateWorkflow={() => {
              setLaunchPlaybookId(null);
              setIsLaunchOpen(true);
            }}
          />
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
        <div className="grid min-h-0 w-full min-w-0 gap-3 lg:h-full lg:min-h-0 lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
          <section
            data-workflows-top-strip="true"
            className="grid shrink-0 gap-2.5 sm:gap-3"
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setIsRailHidden((current) => !current)}>
                {isRailHidden ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                {isRailHidden ? 'Show workflows' : 'Hide workflows'}
              </Button>
              {isRailHidden ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setLaunchPlaybookId(null);
                    setIsLaunchOpen(true);
                  }}
                >
                  New Workflow
                </Button>
              ) : null}
            </div>
            {workflow && workspacePacket ? (
               <WorkflowStateStrip
                 workflow={workflow}
                 stickyStrip={workspacePacket.sticky_strip}
                 board={board}
                 selectedScopeLabel={selectedScopeLabel}
                addWorkLabel={describeHeaderAddWorkLabel({
                  scopeKind: tabScope,
                  lifecycle: workflow?.lifecycle,
                })}
                onTabChange={(tab) => patchPageState(navigate, pageState, { tab })}
                 onAddWork={() => {
                    setAddWorkTargetWorkItemId(
                      resolveHeaderAddWorkTargetWorkItemId({
                        scopeKind: tabScope,
                        workItemId: boardSelection.workItemId,
                      }),
                    );
                    setRepeatSourceWorkItemId(null);
                    setIsAddWorkOpen(true);
                  }}
               />
             ) : null}
          </section>

          {workflow && workspacePacket ? (
            <div
              ref={workspaceSplitRef}
              className={buildWorkflowWorkspaceSplitClassName()}
              style={buildWorkflowWorkspaceSplitStyle(workbenchFraction)}
            >
              <section
                data-workflows-board-frame="true"
                className="flex h-full min-h-[11rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[15rem] lg:min-h-0"
              >
                <WorkflowBoard
                  workflowId={workflow.id}
                  board={board}
                  workflowState={workflow.state}
                  selectedWorkItemId={boardSelection.workItemId}
                  boardMode={pageState.boardMode}
                  onBoardModeChange={(boardMode) =>
                    patchPageState(navigate, pageState, { boardMode })
                  }
                  onSelectWorkItem={handleSelectWorkItem}
                  onWorkItemAction={({ workItemId, action }) => {
                    switch (action) {
                      case 'needs-action':
                        patchPageState(navigate, pageState, { workItemId, tab: 'needs_action' });
                        return;
                      case 'steer':
                        patchPageState(navigate, pageState, { workItemId, tab: 'details' });
                        setSteeringTargetWorkItemId(workItemId);
                        setIsSteeringOpen(true);
                        return;
                      case 'repeat':
                        patchPageState(navigate, pageState, { workItemId });
                        setAddWorkTargetWorkItemId(null);
                        setRepeatSourceWorkItemId(workItemId);
                        setIsAddWorkOpen(true);
                        return;
                      case 'pause':
                      case 'resume':
                      case 'cancel':
                        void handleWorkItemLifecycleAction(workItemId, action);
                        return;
                    }
                  }}
                />
              </section>
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
              <section
                data-workflows-workbench-frame="true"
                className="flex h-full min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[16rem] lg:min-h-0"
              >
                <WorkflowBottomWorkbench
                  workflowId={workflow.id}
                  workflow={workflow}
                  stickyStrip={workspacePacket.sticky_strip}
                  board={board}
                  workflowName={workflow.name}
                  packet={workspacePacket}
                  activeTab={activeTab}
                  selectedWorkItemId={boardSelection.workItemId}
                  scopedWorkItemId={scopedWorkItemId}
                  selectedWorkItemTitle={workItemTitle}
                  selectedWorkItem={selectedWorkItem}
                  selectedWorkItemTasks={selectedWorkItemTasks}
                  inputPackets={inputPacketsQuery.data ?? []}
                  workflowParameters={(workflowDetailQuery.data?.parameters as Record<string, unknown> | null | undefined) ?? null}
                  scope={workbenchScope}
                  isScopeLoading={isScopeLoading}
                  onTabChange={(tab) => patchPageState(navigate, pageState, { tab })}
                  onClearWorkItemScope={handleClearWorkItemScope}
                  onOpenAddWork={(workItemId) => {
                    if (workItemId !== undefined) {
                      patchPageState(navigate, pageState, { workItemId: workItemId ?? null });
                    }
                    setAddWorkTargetWorkItemId(workItemId ?? null);
                    setRepeatSourceWorkItemId(null);
                    setIsAddWorkOpen(true);
                  }}
                  onLoadMoreActivity={() =>
                    setActivityLimit((current) => current + ACTIVITY_PAGE_SIZE)
                  }
                  onLoadMoreDeliverables={() =>
                    setDeliverablesLimit((current) => current + DELIVERABLES_PAGE_SIZE)
                  }
                />
              </section>
            </div>
          ) : (
            <section
              data-workflows-workbench-frame="true"
              className="flex h-full min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[16rem] lg:min-h-0"
            >
              <EmptyWorkspaceState
                hasWorkflows={((railPacket?.rows.length ?? 0) + (railPacket?.ongoing_rows.length ?? 0)) > 0}
                onCreateWorkflow={() => {
                  setLaunchPlaybookId(null);
                  setIsLaunchOpen(true);
                }}
              />
            </section>
          )}
        </div>
      </div>

      <WorkflowLaunchDialog
        isOpen={isLaunchOpen}
        onOpenChange={(open) => {
          setIsLaunchOpen(open);
          if (!open) {
            setLaunchPlaybookId(null);
          }
        }}
        initialPlaybookId={launchPlaybookId}
        onLaunched={(workflowId) =>
          patchPageState(navigate, pageState, {
            workflowId,
            workItemId: null,
            tab: null,
          })
        }
      />
      {pageState.workflowId ? (
        <>
          <WorkflowAddWorkDialog
            isOpen={isAddWorkOpen}
            onOpenChange={(open) => {
              setIsAddWorkOpen(open);
              if (!open) {
                setAddWorkTargetWorkItemId(null);
                setRepeatSourceWorkItemId(null);
              }
            }}
            workflowId={pageState.workflowId}
            lifecycle={workflow?.lifecycle}
            board={board}
            workItemId={addWorkTargetWorkItemId}
            prefillSourceWorkItemId={repeatSourceWorkItemId}
            workflowWorkspaceId={workflow?.workspaceId}
          />
          <Dialog
            open={isSteeringOpen}
            onOpenChange={(open) => {
              setIsSteeringOpen(open);
              if (!open) {
                setSteeringTargetWorkItemId(null);
              }
            }}
          >
            <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Steer work item</DialogTitle>
                <DialogDescription>
                  Record guidance for the selected work item and wake the orchestrator on that scope.
                </DialogDescription>
              </DialogHeader>
              {workflow && workspacePacket && steeringWorkItem ? (
                <WorkflowSteering
                  workflowId={workflow.id}
                  workflowName={workflow.name}
                  workflowState={workflow.state}
                  boardColumns={board?.columns ?? []}
                  selectedWorkItemId={steeringWorkItem.id}
                  selectedWorkItemTitle={steeringWorkItem.title}
                  selectedWorkItem={steeringWorkItem}
                  scope={steeringScope}
                  interventions={workspacePacket.steering.recent_interventions}
                  messages={workspacePacket.steering.session.messages}
                  sessionId={workspacePacket.steering.session.session_id}
                  canAcceptRequest={workspacePacket.steering.steering_state.can_accept_request}
                  onRecorded={() => {
                    patchPageState(navigate, pageState, {
                      workItemId: steeringWorkItem.id,
                      tab: 'live_console',
                    });
                    setIsSteeringOpen(false);
                    setSteeringTargetWorkItemId(null);
                  }}
                />
              ) : null}
            </DialogContent>
          </Dialog>
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
          Choose a workflow from the left rail to open its board, details, needs action, live
          console, and deliverables in one place.
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
