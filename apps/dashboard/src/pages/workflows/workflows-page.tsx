import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '../../components/ui/button.js';
import { dashboardApi } from '../../lib/api.js';
import { WorkflowsRail } from './workflows-rail.js';
import {
  buildWorkflowsPageSearchParams,
  readWorkflowsPageState,
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
  const [searchParams, setSearchParams] = useSearchParams();
  const pageState = useMemo(() => readWorkflowsPageState(searchParams), [searchParams]);
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
          workItemId: pageState.workItemId,
          boardMode: pageState.boardMode,
          activityLimit,
          deliverablesLimit,
        })
      : ['workflows', 'workspace', 'none'],
    queryFn: () =>
      dashboardApi.getWorkflowWorkspace(pageState.workflowId as string, {
        workItemId: pageState.workItemId ?? undefined,
        tabScope: pageState.workItemId ? 'selected_work_item' : 'workflow',
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
  const workItemTitle = useMemo(
    () => board?.work_items.find((item) => item.id === pageState.workItemId)?.title ?? null,
    [board, pageState.workItemId],
  );
  const activeTab = pageState.tab ?? workspaceQuery.data?.bottom_tabs.default_tab ?? 'live_console';
  const hasMoreRailRows = (railPacket?.rows.length ?? 0) >= railLimit;

  useEffect(() => {
    if (pageState.workflowId || !railPacket || railPacket.rows.length === 0) {
      return;
    }
    const storedWorkflowId = readStoredWorkflowId();
    const visibleStoredId = railPacket.rows.find((row) => row.workflow_id === storedWorkflowId)?.workflow_id;
    patchPageState(searchParams, setSearchParams, {
      workflowId: visibleStoredId ?? railPacket.selected_workflow_id ?? railPacket.rows[0]?.workflow_id ?? null,
    });
  }, [pageState.workflowId, railPacket, searchParams, setSearchParams]);

  useEffect(() => {
    if (!pageState.workflowId) {
      return;
    }
    writeStoredWorkflowId(pageState.workflowId);
  }, [pageState.workflowId]);

  if ((railPacket?.rows.length ?? 0) === 0 && !pageState.workflowId && !railQuery.isLoading) {
    return (
      <EmptyWorkflowsState
        onCreateWorkflow={() => setIsLaunchOpen(true)}
      />
    );
  }

  return (
    <>
      <div className="grid min-h-[calc(100vh-9rem)] gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        {!isRailHidden ? (
          <div className="min-h-0">
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
              onModeChange={(mode) => patchPageState(searchParams, setSearchParams, { mode, workflowId: null, workItemId: null, tab: null })}
              onSearchChange={(search) => patchPageState(searchParams, setSearchParams, { search, workflowId: null, workItemId: null })}
              onNeedsActionOnlyChange={(needsActionOnly) => patchPageState(searchParams, setSearchParams, { needsActionOnly, workflowId: null, workItemId: null })}
              onShowAllOngoing={() => patchPageState(searchParams, setSearchParams, { ongoingOnly: true, workflowId: null, workItemId: null })}
              onSelectWorkflow={(workflowId) => patchPageState(searchParams, setSearchParams, { workflowId, workItemId: null })}
              onLoadMore={() => setRailLimit((current) => current + RAIL_PAGE_SIZE)}
              onCreateWorkflow={() => setIsLaunchOpen(true)}
            />
          </div>
        ) : null}

        <div className="flex min-h-0 flex-col gap-4">
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
            <>
              <WorkflowStateStrip
                workflow={workflow}
                stickyStrip={workspaceQuery.data.sticky_strip}
                workflowSettings={workflowSettingsQuery.data ?? null}
                selectedScopeLabel={workItemTitle}
                onTabChange={(tab) => patchPageState(searchParams, setSearchParams, { tab })}
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
                  await queryClient.invalidateQueries({ queryKey: ['workflow-settings', pageState.workflowId] });
                }}
              />
              <WorkflowBoard
                workflowId={workflow.id}
                board={board}
                selectedWorkItemId={pageState.workItemId}
                boardMode={pageState.boardMode}
                onBoardModeChange={(boardMode) => patchPageState(searchParams, setSearchParams, { boardMode })}
                onSelectWorkItem={(workItemId) => patchPageState(searchParams, setSearchParams, { workItemId })}
              />
              <WorkflowBottomWorkbench
                workflowId={workflow.id}
                workflowName={workflow.name}
                workflowState={workflow.state}
                workspaceId={workflow.workspaceId}
                packet={workspaceQuery.data}
                activeTab={activeTab}
                selectedWorkItemId={pageState.workItemId}
                selectedWorkItemTitle={workItemTitle}
                onTabChange={(tab) => patchPageState(searchParams, setSearchParams, { tab })}
                onClearWorkItemScope={() => patchPageState(searchParams, setSearchParams, { workItemId: null })}
                onOpenAddWork={() => setIsAddWorkOpen(true)}
                onOpenRedrive={() => setIsRedriveOpen(true)}
                onLoadMoreActivity={() => setActivityLimit((current) => current + ACTIVITY_PAGE_SIZE)}
                onLoadMoreDeliverables={() => setDeliverablesLimit((current) => current + DELIVERABLES_PAGE_SIZE)}
              />
            </>
          ) : (
            <div className="flex min-h-[28rem] items-center justify-center rounded-3xl border border-dashed border-border/70 bg-background/70 p-8">
              <div className="grid max-w-lg gap-3 text-center">
                <LayoutDashboard className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="text-lg font-semibold text-foreground">Select a workflow</p>
                <p className="text-sm text-muted-foreground">
                  Choose a workflow from the left rail to open its board, steering, history, live console, and deliverables in one place.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <WorkflowLaunchDialog
        isOpen={isLaunchOpen}
        onOpenChange={setIsLaunchOpen}
        onLaunched={(workflowId) =>
          patchPageState(searchParams, setSearchParams, {
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
          />
          <WorkflowRedriveDialog
            isOpen={isRedriveOpen}
            onOpenChange={setIsRedriveOpen}
            workflowId={pageState.workflowId}
            workflowName={workflow?.name ?? 'Workflow'}
            workspaceId={workflow?.workspaceId}
            onRedriven={(workflowId) =>
              patchPageState(searchParams, setSearchParams, {
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

function patchPageState(
  searchParams: URLSearchParams,
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  patch: Partial<WorkflowsPageState>,
): void {
  setSearchParams((current) => buildWorkflowsPageSearchParams(current, patch), {
    replace: true,
  });
  void searchParams;
}
