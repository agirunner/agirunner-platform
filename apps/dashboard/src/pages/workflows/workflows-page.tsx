import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/button.js';
import { dashboardApi } from '../../lib/api.js';
import { WorkflowsRail } from './workflows-rail.js';
import {
  buildWorkflowsPageSearchParams,
  buildWorkflowsPageHref,
  readWorkflowsPageState,
  resolveSelectedWorkflowId,
  resolveWorkflowTabScope,
  type WorkflowsPageState,
} from './workflows-page.support.js';
import {
  readStoredWorkflowId,
  readStoredWorkflowRailHidden,
  writeStoredWorkflowId,
  writeStoredWorkflowRailHidden,
} from './workflows-page.storage.js';
import { buildWorkflowRailQueryKey, buildWorkflowWorkspaceQueryKey } from './workflows-query.js';
import { useWorkflowRailRealtime, useWorkflowWorkspaceRealtime } from './workflows-realtime.js';
import { WorkflowBoard } from './workflow-board.js';
import { WorkflowLaunchDialog } from './workflow-launch-dialog.js';
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
          workItemId: resolveWorkflowTabScope(
            pageState.tab,
            pageState.workItemId,
          ) === 'selected_work_item'
            ? pageState.workItemId
            : null,
          boardMode: pageState.boardMode,
          activityLimit,
          deliverablesLimit,
        })
      : ['workflows', 'workspace', 'none'],
    queryFn: () =>
      dashboardApi.getWorkflowWorkspace(pageState.workflowId as string, {
        workItemId:
          resolveWorkflowTabScope(pageState.tab, pageState.workItemId) === 'selected_work_item'
            ? pageState.workItemId ?? undefined
            : undefined,
        tabScope: resolveWorkflowTabScope(pageState.tab, pageState.workItemId),
        boardMode: pageState.boardMode,
        historyLimit: activityLimit,
        deliverablesLimit,
      }),
    enabled: Boolean(pageState.workflowId),
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
    workItemId: pageState.workItemId,
    boardMode: pageState.boardMode,
  });

  const railPacket = railQuery.data ?? null;
  const workflow = workspaceQuery.data?.workflow ?? null;
  const board = workspaceQuery.data?.board ?? null;
  const scopedWorkItemId =
    resolveWorkflowTabScope(activeTabFromState(pageState), pageState.workItemId) ===
    'selected_work_item'
      ? pageState.workItemId
      : null;
  const workItemTitle = useMemo(
    () => board?.work_items.find((item) => item.id === pageState.workItemId)?.title ?? null,
    [board, pageState.workItemId],
  );
  const activeTab = pageState.tab ?? workspaceQuery.data?.bottom_tabs.default_tab ?? 'live_console';
  const hasMoreRailRows = Boolean(railPacket?.next_cursor) || (railPacket?.rows.length ?? 0) >= railLimit;

  useEffect(() => {
    if (!railPacket || railPacket.rows.length === 0 || pageState.workflowId) {
      return;
    }
    const nextWorkflowId = resolveSelectedWorkflowId({
      currentWorkflowId: pageState.workflowId,
      rows: railPacket.rows,
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
      <div className="grid h-[calc(100vh-9rem)] min-h-[calc(100vh-9rem)] gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        {!isRailHidden ? (
          <div className="min-h-0 overflow-hidden rounded-3xl border border-border/70 bg-stone-50/90 dark:bg-slate-950/70">
            <WorkflowsRail
              mode={pageState.mode}
              search={pageState.search}
              needsActionOnly={pageState.needsActionOnly}
              ongoingOnly={pageState.ongoingOnly}
              rows={railPacket?.rows ?? []}
              ongoingRows={railPacket?.ongoing_rows ?? []}
              selectedWorkflowId={pageState.workflowId}
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
              onCreateWorkflow={() => setIsLaunchOpen(true)}
            />
          </div>
        ) : null}

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden">
          <div className="flex items-center justify-between gap-3">
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

          {workflow && workspaceQuery.data ? (
            <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_minmax(22rem,40vh)] gap-4 overflow-hidden">
              <div className="sticky top-0 z-10">
                <WorkflowStateStrip
                  workflow={workflow}
                  stickyStrip={workspaceQuery.data.sticky_strip}
                  workflowSettings={workflowSettingsQuery.data ?? null}
                  selectedScopeLabel={scopedWorkItemId ? workItemTitle : null}
                  onTabChange={(tab) => patchPageState(navigate, pageState, { tab })}
                  onAddWork={() => setIsAddWorkOpen(true)}
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
              <div className="min-h-0 overflow-hidden rounded-3xl border border-border/70 bg-background/70">
                <div className="h-full overflow-auto p-4">
                  <WorkflowBoard
                    workflowId={workflow.id}
                    board={board}
                    selectedWorkItemId={pageState.workItemId}
                    boardMode={pageState.boardMode}
                    onBoardModeChange={(boardMode) =>
                      patchPageState(navigate, pageState, { boardMode })
                    }
                    onSelectWorkItem={(workItemId) =>
                      patchPageState(navigate, pageState, { workItemId })
                    }
                  />
                </div>
              </div>
              <div className="min-h-0 overflow-hidden rounded-3xl border border-border/70 bg-background/70">
                <div className="h-full overflow-auto p-4">
                  <WorkflowBottomWorkbench
                    workflowId={workflow.id}
                    workflowName={workflow.name}
                    workflowState={workflow.state}
                    workspaceId={workflow.workspaceId}
                    packet={workspaceQuery.data}
                    activeTab={activeTab}
                    selectedWorkItemId={pageState.workItemId}
                    scopedWorkItemId={scopedWorkItemId}
                    selectedWorkItemTitle={workItemTitle}
                    onTabChange={(tab) => patchPageState(navigate, pageState, { tab })}
                    onClearWorkItemScope={() =>
                      patchPageState(navigate, pageState, { workItemId: null })
                    }
                    onOpenAddWork={() => setIsAddWorkOpen(true)}
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
              hasWorkflows={(railPacket?.rows.length ?? 0) > 0}
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
                tab: null,
              })
            }
          />
        </>
      ) : null}
    </>
  );
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
  navigate(buildWorkflowsPageHref(patch, currentState), {
    replace: true,
  });
}

function activeTabFromState(pageState: WorkflowsPageState) {
  return pageState.tab ?? null;
}
