import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  dashboardApi,
  type DashboardTaskRecord,
  type DashboardWorkflowInputPacketRecord,
  type DashboardWorkflowWorkItemRecord,
  type DashboardWorkflowWorkspacePacket,
} from '../../lib/api.js';
import {
  buildRepeatWorkflowLaunchSeed,
  buildWorkflowsPageHref,
  buildWorkflowsPageSearchParams,
  type WorkflowWorkbenchScopeDescriptor,
  readWorkflowsPageState,
  readWorkflowLaunchRequest,
  resolveHeaderAddWorkTargetWorkItemId,
  resolveSelectedWorkflowId,
  workspacePacketMatchesScope,
  resolveWorkspacePlaceholderData,
  resolveWorkflowTabScope,
  type WorkflowsPageState,
  describeWorkflowWorkbenchScope,
} from './workflows-page.support.js';
import {
  readStoredWorkflowRailHidden,
  readStoredWorkflowRailWidth,
  readStoredWorkflowWorkbenchFraction,
  writeStoredWorkflowRailHidden,
  writeStoredWorkflowRailWidth,
  writeStoredWorkflowWorkbenchFraction,
} from './workflows-page.storage.js';
import {
  deriveSelectedWorkflowRow,
  handleWorkflowWorkItemLifecycleAction,
  patchPageState,
  useWorkflowRailSelectionSync,
} from './workflows-page.controller.js';
import { buildWorkflowRailQueryKey, buildWorkflowWorkspaceQueryKey } from './workflows-query.js';
import { useWorkflowRailRealtime, useWorkflowWorkspaceRealtime } from './workflows-realtime.js';
import {
  beginWorkflowRailResize,
  beginWorkflowWorkbenchResize,
  clampWorkflowRailWidthPx,
  clampWorkflowWorkbenchFraction,
  DEFAULT_WORKFLOW_RAIL_WIDTH_PX,
  DEFAULT_WORKFLOW_WORKBENCH_FRACTION,
} from './workflows-layout.js';
import { WorkflowsPageView } from './workflows-page.view.js';

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
  const [launchWorkspaceId, setLaunchWorkspaceId] = useState<string | null>(null);
  const [launchWorkflowName, setLaunchWorkflowName] = useState<string | null>(null);
  const [launchParameterDrafts, setLaunchParameterDrafts] = useState<Record<string, string>>({});
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
    setLaunchWorkspaceId(null);
    setLaunchWorkflowName(null);
    setLaunchParameterDrafts({});
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

  const openWorkflowLaunchDialog = () => {
    setLaunchPlaybookId(null);
    setLaunchWorkspaceId(null);
    setLaunchWorkflowName(null);
    setLaunchParameterDrafts({});
    setIsLaunchOpen(true);
  };

  const handleRailResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    beginWorkflowRailResize({ event, railWidthPx, setRailWidthPx });
  };

  const handleWorkbenchResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    beginWorkflowWorkbenchResize({
      event,
      splitContainer: workspaceSplitRef.current,
      workbenchFraction,
      setWorkbenchFraction,
    });
  };

  useWorkflowRailSelectionSync({
    navigate,
    pageState,
    railPacket,
    selectedWorkflowRow,
    workflowDetailError: workflowDetailQuery.isError,
    workspaceError: workspaceQuery.isError,
  });

  return (
    <WorkflowsPageView
      activeTab={activeTab}
      addWorkTargetWorkItemId={addWorkTargetWorkItemId}
      board={board}
      boardSelectionWorkItemId={boardSelection.workItemId}
      deliverablesLimit={deliverablesLimit}
      hasMoreRailRows={hasMoreRailRows}
      inputPackets={(inputPacketsQuery.data ?? []) as DashboardWorkflowInputPacketRecord[]}
      isAddWorkOpen={isAddWorkOpen}
      isLaunchOpen={isLaunchOpen}
      isRailHidden={isRailHidden}
      isScopeLoading={isScopeLoading}
      isSteeringOpen={isSteeringOpen}
      launchParameterDrafts={launchParameterDrafts}
      launchPlaybookId={launchPlaybookId}
      launchWorkflowName={launchWorkflowName}
      launchWorkspaceId={launchWorkspaceId}
      pageState={pageState}
      railLoading={railQuery.isLoading}
      railOngoingRows={railPacket?.ongoing_rows ?? []}
      railRows={railPacket?.rows ?? []}
      railTotalCount={railPacket?.total_count}
      railVisibleCount={railPacket?.visible_count}
      railWidthPx={railWidthPx}
      repeatSourceWorkItemId={repeatSourceWorkItemId}
      scopedWorkItemId={scopedWorkItemId}
      selectedScopeLabel={selectedScopeLabel}
      selectedWorkItem={selectedWorkItem as DashboardWorkflowWorkItemRecord | null}
      selectedWorkflowRow={selectedWorkflowRow}
      selectedWorkItemTasks={selectedWorkItemTaskRecords as unknown as Record<string, unknown>[]}
      steeringScope={steeringScope as WorkflowWorkbenchScopeDescriptor}
      steeringTargetWorkItemId={steeringTargetWorkItemId}
      steeringWorkItem={steeringWorkItem as DashboardWorkflowWorkItemRecord | null}
      tabScope={tabScope}
      workbenchFraction={workbenchFraction}
      workbenchScope={workbenchScope as WorkflowWorkbenchScopeDescriptor}
      workflow={workflow}
      workflowParameters={
        (workflowDetailQuery.data?.parameters as Record<string, unknown> | null | undefined) ?? null
      }
      workspacePacket={workspacePacket}
      workspaceSplitRef={workspaceSplitRef}
      workItemTitle={workItemTitle}
      onAddWorkOpenChange={(open) => {
        setIsAddWorkOpen(open);
        if (!open) {
          setAddWorkTargetWorkItemId(null);
          setRepeatSourceWorkItemId(null);
        }
      }}
      onBoardModeChange={(boardMode) => patchPageState(navigate, pageState, { boardMode })}
      onClearOngoingFilter={() => patchPageState(navigate, pageState, { ongoingOnly: false })}
      onClearWorkItemScope={handleClearWorkItemScope}
      onCreateWorkflow={openWorkflowLaunchDialog}
      onLaunched={(workflowId) =>
        patchPageState(navigate, pageState, { workflowId, workItemId: null, tab: null })
      }
      onLaunchOpenChange={(open) => {
        setIsLaunchOpen(open);
        if (!open) {
          setLaunchPlaybookId(null);
          setLaunchWorkspaceId(null);
          setLaunchWorkflowName(null);
          setLaunchParameterDrafts({});
        }
      }}
      onLoadMoreActivity={() => setActivityLimit((current) => current + ACTIVITY_PAGE_SIZE)}
      onLoadMoreDeliverables={() =>
        setDeliverablesLimit((current) => current + DELIVERABLES_PAGE_SIZE)
      }
      onLoadMoreRail={() => setRailLimit((current) => current + RAIL_PAGE_SIZE)}
      onNeedsActionOnlyChange={(needsActionOnly) =>
        patchPageState(navigate, pageState, { needsActionOnly })
      }
      onOpenAddWork={(workItemId) => {
        if (workItemId !== undefined) {
          patchPageState(navigate, pageState, { workItemId: workItemId ?? null });
        }
        setAddWorkTargetWorkItemId(workItemId ?? null);
        setRepeatSourceWorkItemId(null);
        setIsAddWorkOpen(true);
      }}
      onRailModeChange={(mode) => patchPageState(navigate, pageState, { mode, tab: null })}
      onRailResizePointerDown={handleRailResizePointerDown}
      onSearchChange={(search) => patchPageState(navigate, pageState, { search })}
      onSelectWorkflow={(workflowId) =>
        patchPageState(navigate, pageState, { workflowId, workItemId: null })
      }
      onSelectWorkItem={handleSelectWorkItem}
      onShowAllOngoing={() => patchPageState(navigate, pageState, { ongoingOnly: true })}
      onSteeringOpenChange={(open) => {
        setIsSteeringOpen(open);
        if (!open) {
          setSteeringTargetWorkItemId(null);
        }
      }}
      onSteeringRecorded={() => {
        if (!steeringWorkItem) {
          return;
        }
        patchPageState(navigate, pageState, {
          workItemId: steeringWorkItem.id,
          tab: 'live_console',
        });
        setIsSteeringOpen(false);
        setSteeringTargetWorkItemId(null);
      }}
      onTabChange={(tab) => patchPageState(navigate, pageState, { tab })}
      onToggleRail={() => setIsRailHidden((current) => !current)}
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
            {
              const repeatLaunchSeed = buildRepeatWorkflowLaunchSeed({
                workflowState: workflow?.state ?? null,
                playbookId: workflow?.playbookId ?? null,
                workspaceId: workflow?.workspaceId ?? null,
                workItemTitle:
                  board?.work_items.find((item) => item.id === workItemId)?.title ?? null,
                workflowParameters:
                  (workflowDetailQuery.data?.parameters as Record<string, unknown> | null | undefined)
                  ?? null,
              });
              if (repeatLaunchSeed) {
                setLaunchPlaybookId(repeatLaunchSeed.playbookId);
                setLaunchWorkspaceId(repeatLaunchSeed.workspaceId);
                setLaunchWorkflowName(repeatLaunchSeed.workflowName);
                setLaunchParameterDrafts(repeatLaunchSeed.parameterDrafts);
                setIsLaunchOpen(true);
                return;
              }
            }
            setAddWorkTargetWorkItemId(null);
            setRepeatSourceWorkItemId(workItemId);
            setIsAddWorkOpen(true);
            return;
          case 'pause':
          case 'resume':
          case 'cancel':
            void handleWorkflowWorkItemLifecycleAction({
              action,
              navigate,
              pageState,
              queryClient,
              workItemId,
            });
            return;
        }
      }}
      onWorkbenchResizePointerDown={handleWorkbenchResizePointerDown}
    />
  );
}
