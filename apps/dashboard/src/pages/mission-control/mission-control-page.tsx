import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { SavedViews, type SavedViewFilters } from '../../components/saved-views/saved-views.js';
import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { dashboardApi } from '../../lib/api.js';
import { MissionControlAttentionRail } from './mission-control-attention-rail.js';
import { MissionControlHistoryView } from './mission-control-history-view.js';
import { MissionControlLiveView } from './mission-control-live-view.js';
import {
  buildMissionControlShellSearchParams,
  readMissionControlShellState,
  type MissionControlMode,
  type MissionControlRail,
} from './mission-control-page.support.js';
import { MissionControlRecentView } from './mission-control-recent-view.js';
import {
  buildMissionControlHistoryQueryKey,
  buildMissionControlLiveQueryKey,
  buildMissionControlRecentQueryKey,
  buildMissionControlWorkspaceQueryKey,
  useMissionControlRealtime,
} from './mission-control-realtime.js';
import { MissionControlLaunchDialog } from './mission-control-launch-dialog.js';
import { MissionControlTaskLensView } from './mission-control-task-lens-view.js';
import { MissionControlWorkspacePane } from './mission-control-workspace-pane.js';
import { normalizeTaskListRecords } from '../task-list/task-list-page.support.js';

const SAVED_VIEW_OPTIONS = [
  { label: 'All active', value: 'all-active' },
  { label: 'Needs action', value: 'needs-action' },
  { label: 'Shipping', value: 'shipping' },
];

const SCOPE_OPTIONS = [
  { label: 'Entire tenant', value: 'entire-tenant' },
  { label: 'Watchlist', value: 'watchlist' },
];

export function MissionControlPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isLaunchDialogOpen, setIsLaunchDialogOpen] = useState(false);
  const shellState = useMemo(() => readMissionControlShellState(searchParams), [searchParams]);
  const currentFilters = useMemo<SavedViewFilters>(
    () => ({
      mode: shellState.mode,
      rail: shellState.rail,
      lens: shellState.lens,
      view: shellState.savedView,
      scope: shellState.scope,
      ...(shellState.workflowId ? { workflow: shellState.workflowId } : {}),
    }),
    [shellState],
  );

  const liveQuery = useQuery({
    queryKey: buildMissionControlLiveQueryKey({
      scope: shellState.scope,
      savedView: shellState.savedView,
    }),
    queryFn: () => dashboardApi.getMissionControlLive({ page: 1, perPage: 100 }),
  });
  const recentQuery = useQuery({
    queryKey: buildMissionControlRecentQueryKey({
      scope: shellState.scope,
      savedView: shellState.savedView,
    }),
    queryFn: () => dashboardApi.getMissionControlRecent({ limit: 50 }),
    enabled: shellState.mode === 'recent',
  });
  const historyQuery = useQuery({
    queryKey: buildMissionControlHistoryQueryKey({
      scope: shellState.scope,
      savedView: shellState.savedView,
      workflowId: shellState.workflowId,
    }),
    queryFn: () =>
      dashboardApi.getMissionControlHistory({
        workflowId: shellState.workflowId ?? undefined,
        limit: 100,
      }),
    enabled: shellState.mode === 'history',
  });
  const workspaceQuery = useQuery({
    queryKey: buildMissionControlWorkspaceQueryKey(shellState.workflowId ?? 'none'),
    queryFn: () => dashboardApi.getMissionControlWorkflowWorkspace(shellState.workflowId as string),
    enabled: Boolean(shellState.workflowId),
  });
  const tasksQuery = useQuery({
    queryKey: ['tasks', 'mission-control', shellState.mode],
    queryFn: () => dashboardApi.listTasks({ per_page: '100' }),
    enabled: shellState.lens === 'tasks',
  });
  const taskLensResponse = useMemo(
    () => normalizeTaskListRecords(tasksQuery.data),
    [tasksQuery.data],
  );

  useMissionControlRealtime(queryClient);
  const isMobileWorkflowTakeover = shellState.rail === 'workflow' && Boolean(shellState.workflowId);

  function patchShellState(
    patch: Partial<ReturnType<typeof readMissionControlShellState>>,
  ): void {
    setSearchParams((current) => buildMissionControlShellSearchParams(current, patch), {
      replace: true,
    });
  }

  function applySavedFilters(filters: SavedViewFilters): void {
    patchShellState({
      mode: filters.mode as MissionControlMode | undefined,
      rail: filters.rail as MissionControlRail | undefined,
      lens: filters.lens === 'tasks' ? 'tasks' : 'workflows',
      tab: shellState.tab,
      savedView: filters.view ?? shellState.savedView,
      scope: filters.scope ?? shellState.scope,
      workflowId: filters.workflow ?? null,
    });
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        navHref="/mission-control"
        title="Mission Control"
        description="Tenant-wide live operations shell for monitoring workflow posture, reviewing recent changes, and drilling into one workflow without losing the wider operational picture."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SavedViews
              storageKey="mission-control"
              currentFilters={currentFilters}
              onApply={applySavedFilters}
              onReset={() =>
                patchShellState({
                  mode: 'live',
                  rail: 'attention',
                  lens: 'workflows',
                  tab: 'overview',
                  savedView: 'all-active',
                  scope: 'entire-tenant',
                  workflowId: null,
                })
              }
            />
            <Button size="sm" onClick={() => setIsLaunchDialogOpen(true)}>Launch workflow</Button>
          </div>
        }
      />

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border/80 bg-surface/70 p-4">
        <Tabs
          value={shellState.mode}
          onValueChange={(value) => patchShellState({ mode: value as MissionControlMode })}
        >
          <TabsList>
            <TabsTrigger value="live">Live</TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        </Tabs>

        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <span>Saved view</span>
          <select
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            value={shellState.savedView}
            onChange={(event) => patchShellState({ savedView: event.target.value })}
          >
            {SAVED_VIEW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Scope</span>
          <select
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            value={shellState.scope}
            onChange={(event) => patchShellState({ scope: event.target.value })}
          >
            {SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_30rem]">
        <section className={`space-y-4 ${isMobileWorkflowTakeover ? 'hidden xl:block' : ''}`}>
          <div className="flex flex-wrap items-center gap-2">
            <RailToggle
              isActive={shellState.lens === 'workflows'}
              label="Workflow canvas"
              onClick={() => patchShellState({ lens: 'workflows' })}
            />
            <RailToggle
              isActive={shellState.lens === 'tasks'}
              label="Task lens"
              onClick={() => patchShellState({ lens: 'tasks' })}
            />
          </div>
          {shellState.lens === 'tasks' ? (
            <MissionControlTaskLensView
              mode={shellState.mode}
              tasks={taskLensResponse}
              isLoading={tasksQuery.isLoading}
            />
          ) : shellState.mode === 'live' ? (
            <MissionControlLiveView
              response={liveQuery.data ?? null}
              isLoading={liveQuery.isLoading}
              selectedWorkflowId={shellState.workflowId}
              lens={shellState.lens}
              onSelectWorkflow={(workflowId) =>
                patchShellState({
                  rail: 'workflow',
                  workflowId,
                  tab: 'overview',
                })
              }
            />
          ) : shellState.mode === 'recent' ? (
            <MissionControlRecentView
              response={recentQuery.data ?? null}
              isLoading={recentQuery.isLoading}
              lens={shellState.lens}
              taskLensResponse={taskLensResponse}
            />
          ) : (
            <MissionControlHistoryView
              response={historyQuery.data ?? null}
              isLoading={historyQuery.isLoading}
              lens={shellState.lens}
              taskLensResponse={taskLensResponse}
            />
          )}
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <RailToggle
              isActive={shellState.rail === 'attention'}
              label="Attention"
              onClick={() => patchShellState({ rail: 'attention' })}
            />
            <RailToggle
              isActive={shellState.rail === 'workflow'}
              label="Workflow"
              onClick={() => patchShellState({ rail: 'workflow' as MissionControlRail })}
            />
          </div>
          {shellState.rail === 'attention' ? (
            <MissionControlSurfaceCard
              title="Attention rail"
              description="Interrupt-first queue for decisions, interventions, and watchlist items."
            >
              <MissionControlAttentionRail items={liveQuery.data?.attentionItems ?? []} />
            </MissionControlSurfaceCard>
          ) : (
            <MissionControlWorkspacePane
              workflowId={shellState.workflowId}
              response={workspaceQuery.data ?? null}
              isLoading={workspaceQuery.isLoading}
              initialTab={shellState.tab}
              isMobileTakeover={isMobileWorkflowTakeover}
            />
          )}
        </section>
      </div>
      <MissionControlLaunchDialog
        isOpen={isLaunchDialogOpen}
        onOpenChange={setIsLaunchDialogOpen}
        onLaunched={(workflowId) =>
          patchShellState({
            rail: 'workflow',
            workflowId,
            tab: 'overview',
          })
        }
      />
    </div>
  );
}

function MissionControlSurfaceCard(props: {
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{props.children}</CardContent>
    </Card>
  );
}

function RailToggle(props: {
  isActive: boolean;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button onClick={props.onClick} size="sm" variant={props.isActive ? 'default' : 'outline'}>
      {props.label}
    </Button>
  );
}
