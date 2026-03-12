import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';

import {
  dashboardApi,
  type DashboardEffectiveModelResolution,
  type DashboardWorkflowRelationRef,
  type DashboardWorkflowActivationRecord,
  type DashboardWorkflowModelOverridesResponse,
  type DashboardWorkflowBoardResponse,
  type DashboardWorkflowRecord,
  type DashboardWorkflowResolvedModelsResponse,
  type DashboardWorkflowStageRecord,
  type DashboardProjectRecord,
  type DashboardProjectTimelineEntry,
  type DashboardResolvedDocumentReference,
  type DashboardResolvedConfigResponse,
} from '../lib/api.js';
import { subscribeToEvents } from '../lib/sse.js';
import {
  groupTasksByStage,
  readWorkflowProjectId,
  readProjectMemoryEntries,
  readWorkflowRunSummary,
  shouldInvalidateWorkflowRealtimeEvent,
  summarizeTasks,
  type DashboardWorkflowTaskRow,
} from './workflow-detail-support.js';
import {
  buildStructuredObject,
  createStructuredEntryDraft,
  objectToStructuredDrafts,
  type StructuredEntryDraft,
} from './projects/project-detail-support.js';
import { WorkflowWorkItemDetailPanel } from './workflow-work-item-detail-panel.js';
import {
  findWorkItemById,
  flattenGroupedWorkItems,
  groupWorkflowWorkItems,
  normalizeWorkItemTasks,
  selectTasksForWorkItem,
} from './workflow-work-item-detail-support.js';
import {
  MissionControlCard,
  PlaybookBoardCard,
  ProjectTimelineCard,
  TaskGraphCard,
  WorkflowActivationsCard,
  WorkflowStagesCard,
} from './workflow-detail-sections.js';
import { WorkflowInteractionTimelineCard } from './workflow-history-card.js';
import { WorkflowDocumentsCard, ProjectMemoryCard } from './workflow-detail-content.js';
import { invalidateWorkflowQueries } from './workflow-detail-query.js';
import { buildWorkflowDetailHash } from './workflow-detail-permalinks.js';
import { ChainWorkflowDialog } from '../components/chain-workflow-dialog.js';
import { StructuredRecordView } from '../components/structured-data.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { Textarea } from '../components/ui/textarea.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';

interface TaskListResult {
  data: DashboardWorkflowTaskRow[];
}

function deriveWorkflowStageDisplay(
  workflow: DashboardWorkflowRecord | undefined,
): { label: string; value: string | null } {
  if (!workflow) {
    return { label: 'Current stage', value: null };
  }

  const liveStages = Array.from(
    new Set([
      ...(workflow.work_item_summary?.active_stage_names ?? []),
      ...(workflow.active_stages ?? []),
    ]),
  ).filter((stage) => stage.trim().length > 0);

  if (workflow.lifecycle === 'continuous') {
    if (liveStages.length > 0) {
      return { label: 'Live stages', value: liveStages.join(', ') };
    }
    return { label: 'Live stages', value: null };
  }

  if (workflow.current_stage) {
    return { label: 'Current stage', value: workflow.current_stage };
  }
  if (liveStages.length > 0) {
    return { label: 'Current stage', value: liveStages.join(', ') };
  }
  return { label: 'Current stage', value: null };
}

export function WorkflowDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const workflowId = params.id ?? '';
  const queryClient = useQueryClient();
  const [memoryKey, setMemoryKey] = useState('last_operator_note');
  const [memoryDrafts, setMemoryDrafts] = useState<StructuredEntryDraft[]>(() => {
    const drafts = objectToStructuredDrafts({ summary: '' });
    return drafts.length > 0 ? drafts : [createStructuredEntryDraft()];
  });
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryMessage, setMemoryMessage] = useState<string | null>(null);
  const [workItemTitle, setWorkItemTitle] = useState('');
  const [workItemGoal, setWorkItemGoal] = useState('');
  const [workItemStage, setWorkItemStage] = useState('');
  const [workItemError, setWorkItemError] = useState<string | null>(null);
  const [isChainDialogOpen, setIsChainDialogOpen] = useState(false);
  const selectedWorkItemId = searchParams.get('work_item');
  const selectedActivationId = searchParams.get('activation');
  const selectedChildWorkflowId = searchParams.get('child');
  const selectedGateStageName = searchParams.get('gate');

  const workflowQuery = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: () => dashboardApi.getWorkflow(workflowId) as Promise<DashboardWorkflowRecord>,
    enabled: workflowId.length > 0,
  });
  const taskQuery = useQuery({
    queryKey: ['tasks', workflowId],
    queryFn: () => dashboardApi.listTasks({ workflow_id: workflowId }) as Promise<TaskListResult>,
    enabled: workflowId.length > 0,
  });
  const historyQuery = useInfiniteQuery({
    queryKey: ['workflow-history', workflowId],
    queryFn: ({ pageParam }) =>
      dashboardApi.listWorkflowEvents(workflowId, {
        limit: '20',
        ...(pageParam ? { after: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.meta.next_after ?? undefined,
    enabled: workflowId.length > 0,
  });
  const configQuery = useQuery({
    queryKey: ['workflow-config', workflowId],
    queryFn: () =>
      dashboardApi.getResolvedWorkflowConfig(
        workflowId,
        true,
      ) as Promise<DashboardResolvedConfigResponse>,
    enabled: workflowId.length > 0,
  });
  const isPlaybookWorkflow = Boolean(workflowQuery.data?.playbook_id);
  const boardQuery = useQuery({
    queryKey: ['workflow-board', workflowId],
    queryFn: () =>
      dashboardApi.getWorkflowBoard(workflowId) as Promise<DashboardWorkflowBoardResponse>,
    enabled: workflowId.length > 0 && isPlaybookWorkflow,
  });
  const stagesQuery = useQuery({
    queryKey: ['workflow-stages', workflowId],
    queryFn: () =>
      dashboardApi.listWorkflowStages(workflowId) as Promise<DashboardWorkflowStageRecord[]>,
    enabled: workflowId.length > 0 && isPlaybookWorkflow,
  });
  const activationsQuery = useQuery({
    queryKey: ['workflow-activations', workflowId],
    queryFn: () =>
      dashboardApi.listWorkflowActivations(workflowId) as Promise<
        DashboardWorkflowActivationRecord[]
      >,
    enabled: workflowId.length > 0 && isPlaybookWorkflow,
  });
  const workflowModelOverridesQuery = useQuery({
    queryKey: ['workflow-model-overrides', workflowId],
    queryFn: () =>
      dashboardApi.getWorkflowModelOverrides(workflowId) as Promise<DashboardWorkflowModelOverridesResponse>,
    enabled: workflowId.length > 0,
  });
  const resolvedModelsQuery = useQuery({
    queryKey: ['workflow-resolved-models', workflowId],
    queryFn: () =>
      dashboardApi.getResolvedWorkflowModels(workflowId) as Promise<DashboardWorkflowResolvedModelsResponse>,
    enabled: workflowId.length > 0,
  });

  const projectId = readWorkflowProjectId(workflowQuery.data);
  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => dashboardApi.getProject(projectId ?? '') as Promise<DashboardProjectRecord>,
    enabled: Boolean(projectId),
  });
  const documentQuery = useQuery({
    queryKey: ['workflow-documents', workflowId],
    queryFn: () =>
      dashboardApi.listWorkflowDocuments(workflowId) as Promise<
        DashboardResolvedDocumentReference[]
      >,
    enabled: workflowId.length > 0,
  });
  const timelineQuery = useQuery({
    queryKey: ['project-timeline', projectId],
    queryFn: () =>
      dashboardApi.getProjectTimeline(projectId ?? '') as Promise<DashboardProjectTimelineEntry[]>,
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    if (!workItemStage && stagesQuery.data && stagesQuery.data.length > 0) {
      setWorkItemStage(stagesQuery.data[0].name);
    }
  }, [stagesQuery.data, workItemStage]);

  useEffect(() => {
    if (!boardQuery.data) {
      return;
    }
    const workItems = flattenGroupedWorkItems(groupWorkflowWorkItems(boardQuery.data?.work_items ?? []));
    const hasExplicitNonWorkItemSelection =
      selectedActivationId !== null || selectedChildWorkflowId !== null || selectedGateStageName !== null;
    if (workItems.length === 0) {
      if (selectedWorkItemId !== null) {
        clearWorkflowSelection('work_item');
      }
      return;
    }
    if (selectedWorkItemId && workItems.some((item) => item.id === selectedWorkItemId)) {
      return;
    }
    if (hasExplicitNonWorkItemSelection) {
      return;
    }
    updateWorkflowSelection('work_item', workItems[0].id);
  }, [
    boardQuery.data,
    selectedActivationId,
    selectedChildWorkflowId,
    selectedGateStageName,
    selectedWorkItemId,
  ]);

  useEffect(() => {
    if (!workflowId) {
      return;
    }

    return subscribeToEvents((eventType, payload) => {
      if (!shouldInvalidateWorkflowRealtimeEvent(eventType, workflowId, payload)) {
        return;
      }
      void invalidateWorkflowQueries(queryClient, workflowId, projectId);
    });
  }, [workflowId, projectId, queryClient]);

  useEffect(() => {
    if (!location.hash) {
      return;
    }
    const targetId = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    if (!targetId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activationsQuery.data?.length,
    boardQuery.data?.work_items,
    location.hash,
    selectedActivationId,
    selectedChildWorkflowId,
    selectedGateStageName,
    selectedWorkItemId,
    stagesQuery.data?.length,
  ]);

  const summary = useMemo(() => summarizeTasks(taskQuery.data?.data ?? []), [taskQuery.data?.data]);
  const historyEvents = useMemo(
    () => historyQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [historyQuery.data],
  );
  const costSummary = useMemo(() => {
    const tasks = taskQuery.data?.data ?? [];
    return tasks.reduce(
      (acc, task) => {
        const typedTask = task as DashboardWorkflowTaskRow & {
          metrics?: { total_cost_usd?: number };
        };
        acc.totalCostUsd += Number(typedTask.metrics?.total_cost_usd ?? 0);
        return acc;
      },
      { totalCostUsd: 0 },
    );
  }, [taskQuery.data?.data]);
  const stageNames = useMemo(() => {
    const names = new Set<string>();
    for (const stage of stagesQuery.data ?? []) {
      names.add(stage.name);
    }
    for (const stageName of workflowQuery.data?.work_item_summary?.active_stage_names ?? []) {
      names.add(stageName);
    }
    for (const stageName of workflowQuery.data?.active_stages ?? []) {
      names.add(stageName);
    }
    const shouldUseCurrentStageFallback = workflowQuery.data?.lifecycle !== 'continuous';
    const currentWorkflowStage = workflowQuery.data?.current_stage;
    if (currentWorkflowStage && shouldUseCurrentStageFallback) {
      names.add(currentWorkflowStage);
    }
    return Array.from(names);
  }, [
    stagesQuery.data,
    workflowQuery.data?.active_stages,
    workflowQuery.data?.current_stage,
    workflowQuery.data?.lifecycle,
    workflowQuery.data?.work_item_summary?.active_stage_names,
  ]);
  const stageGroups = useMemo(
    () => groupTasksByStage(taskQuery.data?.data ?? [], stageNames),
    [stageNames, taskQuery.data?.data],
  );
  const runSummary = useMemo(
    () => readWorkflowRunSummary(workflowQuery.data),
    [workflowQuery.data],
  );
  const workItemTasks = useMemo(
    () => normalizeWorkItemTasks(taskQuery.data),
    [taskQuery.data],
  );
  const groupedWorkItems = useMemo(
    () => groupWorkflowWorkItems(boardQuery.data?.work_items ?? []),
    [boardQuery.data?.work_items],
  );
  const selectedBoardWorkItem = useMemo(
    () => (selectedWorkItemId ? findWorkItemById(groupedWorkItems, selectedWorkItemId) : null),
    [groupedWorkItems, selectedWorkItemId],
  );
  const selectedWorkItemTasks = useMemo(
    () =>
      selectedWorkItemId
        ? selectTasksForWorkItem(workItemTasks, selectedWorkItemId, groupedWorkItems)
        : [],
    [groupedWorkItems, selectedWorkItemId, workItemTasks],
  );
  const stageDisplay = useMemo(
    () => deriveWorkflowStageDisplay(workflowQuery.data),
    [workflowQuery.data],
  );
  const memoryEntries = useMemo(
    () => readProjectMemoryEntries(projectQuery.data),
    [projectQuery.data],
  );
  const projectTimelineEntries = useMemo(
    () =>
      mergeTimelineEntriesWithWorkflowRelations(
        timelineQuery.data ?? [],
        workflowQuery.data?.workflow_relations?.children ?? [],
      ),
    [timelineQuery.data, workflowQuery.data?.workflow_relations?.children],
  );

  if (workflowQuery.data && !workflowQuery.data.playbook_id) {
    return (
      <section className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Board Detail Unavailable</CardTitle>
            <CardDescription>
              This detail view requires a playbook-backed board run.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>
    );
  }

  async function handleMemorySave() {
    let parsedValue: Record<string, unknown> | undefined;
    if (!projectId) {
      setMemoryError('Project memory is only available for project-backed workflows.');
      return;
    }
    if (!memoryKey.trim()) {
      setMemoryError('Memory key must not be empty.');
      return;
    }
    try {
      parsedValue = buildStructuredObject(memoryDrafts, 'Project memory');
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : 'Memory fields are invalid.');
      return;
    }
    if (!parsedValue || Object.keys(parsedValue).length === 0) {
      setMemoryError('Memory value must include at least one field.');
      return;
    }
    setMemoryError(null);
    setMemoryMessage(null);
    await dashboardApi.patchProjectMemory(projectId, {
      key: memoryKey.trim(),
      value: parsedValue,
    });
    setMemoryMessage(`Updated project memory key '${memoryKey.trim()}'.`);
    await invalidateWorkflowQueries(queryClient, workflowId, projectId);
  }

  const createWorkItemMutation = useMutation({
    mutationFn: async () => {
      if (!workItemTitle.trim()) {
        throw new Error('Work item title is required.');
      }
      return dashboardApi.createWorkflowWorkItem(workflowId, {
        title: workItemTitle.trim(),
        goal: workItemGoal.trim() || undefined,
        stage_name: workItemStage || undefined,
      });
    },
    onSuccess: async () => {
      setWorkItemTitle('');
      setWorkItemGoal('');
      setWorkItemError(null);
      await invalidateWorkflowQueries(queryClient, workflowId, projectId);
    },
    onError: (error) => {
      setWorkItemError(error instanceof Error ? error.message : 'Failed to create work item');
    },
  });

  function updateWorkflowSelection(
    key: 'work_item' | 'activation' | 'child' | 'gate',
    value: string,
  ): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(key, value);
        if (key !== 'work_item') {
          next.delete('work_item');
        }
        if (key !== 'activation') {
          next.delete('activation');
        }
        if (key !== 'child') {
          next.delete('child');
        }
        if (key !== 'gate') {
          next.delete('gate');
        }
        return next;
      },
      { replace: true },
    );
  }

  function clearWorkflowSelection(key: 'work_item' | 'activation' | 'child' | 'gate'): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(key);
        return next;
      },
      { replace: true },
    );
  }

  const workItemSummary = workflowQuery.data?.work_item_summary;
  const activeStageNames = Array.from(
    new Set([
      ...(workItemSummary?.active_stage_names ?? []),
      ...(workflowQuery.data?.active_stages ?? []),
    ]),
  );

  return (
    <section className="mx-auto grid w-full max-w-[1600px] gap-8 px-4 py-6 lg:px-6 xl:px-8">
      <section data-testid="workflow-detail-operator-surface" className="grid gap-8">
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.7fr)]">
          <Card className="overflow-hidden border-border/80 bg-card shadow-md">
            <CardHeader className="gap-4 border-b border-border/70 bg-gradient-to-br from-surface via-surface to-border/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>Board Detail</CardTitle>
                  <CardDescription>
                    Live operator view of the workflow, board state, and orchestration context.
                  </CardDescription>
                </div>
                {workflowQuery.data ? (
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={workflowQuery.data.state === 'completed' ? 'success' : 'outline'}>
                      {workflowQuery.data.state}
                    </Badge>
                    {isPlaybookWorkflow && stageDisplay.value ? (
                      <Badge variant="secondary">{stageDisplay.label}: {stageDisplay.value}</Badge>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="grid gap-5 p-5">
              {workflowQuery.isLoading ? (
                <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
                  Loading board run...
                </p>
              ) : null}
              {workflowQuery.error ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                  Failed to load board run.
                </p>
              ) : null}
              {workflowQuery.data ? (
                <>
                  <div className="grid gap-5 rounded-2xl border border-border/70 bg-border/10 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">
                          Board Run
                        </p>
                        <h2 className="text-2xl font-semibold text-foreground">
                          {workflowQuery.data.name}
                        </h2>
                        <p className="text-sm text-muted">
                          {workflowQuery.data.playbook_name
                            ? `${workflowQuery.data.playbook_name} orchestrated board run`
                            : 'Playbook-backed orchestrated board run'}
                          {workflowQuery.data.project_id ? ' linked to a project.' : '.'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {workflowQuery.data.playbook_name ? (
                          <Badge variant="outline">{workflowQuery.data.playbook_name}</Badge>
                        ) : null}
                        {workflowQuery.data.lifecycle ? (
                          <Badge variant="secondary">{workflowQuery.data.lifecycle}</Badge>
                        ) : null}
                        {workflowQuery.data.project_id ? (
                          <Badge variant="outline">Project-linked</Badge>
                        ) : null}
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/work/workflows/${workflowId}/inspector`}>Open Inspector</Link>
                        </Button>
                        {projectId ? (
                          <Button asChild size="sm" variant="outline">
                            <Link to={`/projects/${projectId}/artifacts?workflow=${workflowId}`}>Workflow Artifacts</Link>
                          </Button>
                        ) : null}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <WorkflowSignalTile
                          label="Open Work"
                          value={String(workItemSummary?.open_work_item_count ?? 0)}
                          detail="work items"
                        />
                        <WorkflowSignalTile
                          label="Awaiting Gates"
                          value={String(workItemSummary?.awaiting_gate_count ?? 0)}
                          detail="stage reviews"
                        />
                        <WorkflowSignalTile
                          label="Live Stages"
                          value={String(activeStageNames.length)}
                          detail={activeStageNames.length > 0 ? activeStageNames.join(', ') : 'none yet'}
                        />
                        <WorkflowSignalTile
                          label="Execution Cost"
                          value={`$${costSummary.totalCostUsd.toFixed(4)}`}
                          detail="total run cost"
                        />
                      </div>
                    </div>
                    <dl className="grid gap-3 rounded-xl border border-border/70 bg-surface/80 p-4 text-sm">
                      <div className="grid gap-1">
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                          Workflow ID
                        </dt>
                        <dd className="font-mono text-xs text-foreground">{workflowQuery.data.id}</dd>
                      </div>
                      <div className="grid gap-1">
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                          Created
                        </dt>
                        <dd className="text-foreground">
                          {new Date(workflowQuery.data.created_at).toLocaleString()}
                        </dd>
                      </div>
                      <div className="grid gap-1">
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                          Stage Signal
                        </dt>
                        <dd className="text-foreground">{stageDisplay.value ?? 'No active stage yet'}</dd>
                      </div>
                      <div className="grid gap-1">
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                          Project
                        </dt>
                        <dd className="text-foreground">
                          {projectQuery.data?.name ?? (workflowQuery.data.project_id ? 'Linked project' : 'Standalone workflow')}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="grid gap-3 rounded-2xl border border-border/70 bg-surface/80 p-5">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-foreground">Operator Context</div>
                      <p className="text-sm text-muted">
                        Shared context, run parameters, and orchestration metadata attached to this board run.
                      </p>
                    </div>
                    <StructuredRecordView
                      data={workflowQuery.data.context}
                      emptyMessage="No workflow context is available yet."
                    />
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid content-start gap-6">
            <MissionControlCard
              summary={summary}
              totalCostUsd={costSummary.totalCostUsd}
              onPause={() =>
                void dashboardApi
                  .pauseWorkflow(workflowId)
                  .then(() => invalidateWorkflowQueries(queryClient, workflowId, projectId))
              }
              onResume={() =>
                void dashboardApi
                  .resumeWorkflow(workflowId)
                  .then(() => invalidateWorkflowQueries(queryClient, workflowId, projectId))
              }
              onCancel={() =>
                void dashboardApi
                  .cancelWorkflow(workflowId)
                  .then(() => invalidateWorkflowQueries(queryClient, workflowId, projectId))
              }
            />
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
              <WorkflowSignalTile
                label="Task health"
                value={`${summary.in_progress} in progress`}
                detail={`${summary.blocked} blocked, ${summary.failed} failed`}
              />
              <WorkflowSignalTile
                label="Board momentum"
                value={`${workItemSummary?.completed_work_item_count ?? 0} complete`}
                detail={`${workItemSummary?.open_work_item_count ?? 0} open work items`}
              />
            </div>
          </div>
        </div>

        {isPlaybookWorkflow ? (
          <section className="rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.6fr)]">
              <Card className="bg-surface/80">
                <CardHeader>
                  <CardTitle>Create Work Item</CardTitle>
                  <CardDescription>
                    Add new work directly onto the playbook board with a stage-aware form.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-foreground">Title</span>
                  <Input
                    value={workItemTitle}
                    onChange={(event) => {
                      setWorkItemError(null);
                      setWorkItemTitle(event.target.value);
                    }}
                    placeholder="e.g. Implement billing webhooks"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-foreground">Stage</span>
                  <Select
                    value={workItemStage || '__auto__'}
                    onValueChange={(value) => setWorkItemStage(value === '__auto__' ? '' : value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Use default stage" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">Use default stage</SelectItem>
                      {(stagesQuery.data ?? []).map((stage) => (
                        <SelectItem key={stage.id} value={stage.name}>
                          {stage.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-foreground">Goal</span>
                  <Textarea
                    value={workItemGoal}
                    onChange={(event) => {
                      setWorkItemError(null);
                      setWorkItemGoal(event.target.value);
                    }}
                    className="min-h-[88px]"
                    placeholder="Describe the desired outcome and acceptance intent."
                  />
                </label>
                {workItemError ? (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                    {workItemError}
                  </p>
                ) : null}
                <div className="flex justify-end">
                  <Button
                    onClick={() => void createWorkItemMutation.mutate()}
                    disabled={createWorkItemMutation.isPending}
                  >
                    {createWorkItemMutation.isPending ? 'Creating…' : 'Create Work Item'}
                  </Button>
                </div>
                </CardContent>
              </Card>

              <Card className="bg-surface/80">
                <CardHeader>
                  <CardTitle>Launch Child Board</CardTitle>
                  <CardDescription>
                    Create a linked follow-up board run using a playbook and preserve lineage.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-3 rounded-lg border border-dashed border-border/70 bg-border/10 p-4">
                    <p className="text-sm text-muted">
                      Child workflows inherit parent context and stay linked for operator drill-in.
                    </p>
                    <div className="flex justify-end">
                      <Button onClick={() => setIsChainDialogOpen(true)}>Create Child Board</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        ) : null}

        <section className="rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
          <PlaybookBoardCard
            workflowId={workflowId}
            board={boardQuery.data}
            stages={stagesQuery.data ?? []}
            isLoading={boardQuery.isLoading}
            hasError={Boolean(boardQuery.error)}
            selectedWorkItemId={selectedWorkItemId}
            onSelectWorkItem={(workItemId) => updateWorkflowSelection('work_item', workItemId)}
            onBoardChanged={() => invalidateWorkflowQueries(queryClient, workflowId, projectId)}
          />
        </section>

        {selectedWorkItemId ? (
          <section
            id={buildWorkflowDetailHash({ workItemId: selectedWorkItemId }).slice(1)}
            className="rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm"
          >
            <WorkflowWorkItemDetailPanel
              workflowId={workflowId}
              workItemId={selectedWorkItemId}
              workItems={groupedWorkItems}
              selectedWorkItem={selectedBoardWorkItem}
              columns={boardQuery.data?.columns ?? []}
              stages={stagesQuery.data ?? []}
              tasks={selectedWorkItemTasks}
              onSelectWorkItem={(workItemId) => updateWorkflowSelection('work_item', workItemId)}
              onWorkItemChanged={() => invalidateWorkflowQueries(queryClient, workflowId, projectId)}
              onClearSelection={() => clearWorkflowSelection('work_item')}
            />
          </section>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-2">
          <WorkflowStagesCard
            stages={stagesQuery.data ?? []}
            isLoading={stagesQuery.isLoading}
            hasError={Boolean(stagesQuery.error)}
            selectedGateStageName={selectedGateStageName}
            onSelectGate={(stageName) => updateWorkflowSelection('gate', stageName)}
          />
          <WorkflowActivationsCard
            activations={activationsQuery.data ?? []}
            isLoading={activationsQuery.isLoading}
            hasError={Boolean(activationsQuery.error)}
            selectedActivationId={selectedActivationId}
            onSelectActivation={(activationId) =>
              updateWorkflowSelection('activation', activationId)
            }
          />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle>Model Overrides</CardTitle>
            <CardDescription>
              Board-run overrides take precedence over project-level model settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {workflowModelOverridesQuery.isLoading ? (
              <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
                Loading model overrides...
              </p>
            ) : null}
            {workflowModelOverridesQuery.error ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                Failed to load board-run model overrides.
              </p>
            ) : null}
            {workflowModelOverridesQuery.data ? (
              <StructuredRecordView
                data={workflowModelOverridesQuery.data}
                emptyMessage="No board-run model overrides configured."
              />
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle>Effective Models</CardTitle>
            <CardDescription>
              Resolved models after applying defaults, project overrides, and workflow launch overrides.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {resolvedModelsQuery.isLoading ? (
              <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
                Resolving effective models...
              </p>
            ) : null}
            {resolvedModelsQuery.error ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                Failed to load effective models.
              </p>
            ) : null}
            {resolvedModelsQuery.data ? (
              <ResolvedModelResolutionList effectiveModels={resolvedModelsQuery.data.effective_models} />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle>Resolved Config</CardTitle>
            <CardDescription>
              Merged playbook, project, and board-run configuration for this operator surface.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {configQuery.isLoading ? (
              <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
                Loading config...
              </p>
            ) : null}
            {configQuery.error ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                Failed to load resolved config.
              </p>
            ) : null}
            {configQuery.data ? (
              <StructuredRecordView
                data={configQuery.data}
                emptyMessage="No resolved configuration available."
              />
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle>Board Summary</CardTitle>
            <CardDescription>
              Continuity summary written into project memory when the board run reaches a terminal state.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {runSummary ? (
              <StructuredRecordView
                data={runSummary}
                emptyMessage="Run summary becomes available after the workflow reaches terminal state."
              />
            ) : (
              <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
                Run summary becomes available after the workflow reaches terminal state.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <WorkflowDocumentsCard
          isLoading={documentQuery.isLoading}
          hasError={Boolean(documentQuery.error)}
          documents={documentQuery.data ?? []}
        />

        <ProjectMemoryCard
          project={projectQuery.data}
          entries={memoryEntries}
          isLoading={projectQuery.isLoading}
          hasError={Boolean(projectQuery.error)}
          memoryKey={memoryKey}
          memoryDrafts={memoryDrafts}
          memoryError={memoryError}
          memoryMessage={memoryMessage}
          onMemoryKeyChange={setMemoryKey}
          onMemoryDraftsChange={setMemoryDrafts}
          onSave={() => void handleMemorySave()}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <TaskGraphCard
          tasks={taskQuery.data?.data ?? []}
          stageGroups={stageGroups}
          isLoading={taskQuery.isLoading}
          hasError={Boolean(taskQuery.error)}
        />

        <WorkflowInteractionTimelineCard
          workflowId={workflowId}
          isLoading={historyQuery.isLoading}
          hasError={Boolean(historyQuery.error)}
          isLoadingMore={historyQuery.isFetchingNextPage}
          hasMore={historyQuery.hasNextPage}
          onLoadMore={() => void historyQuery.fetchNextPage()}
          events={historyEvents}
        />
      </div>

      {projectId ? (
        <ProjectTimelineCard
          isLoading={timelineQuery.isLoading}
          hasError={Boolean(timelineQuery.error)}
          entries={projectTimelineEntries}
          currentWorkflowId={workflowId}
          selectedChildWorkflowId={selectedChildWorkflowId}
          onSelectChildWorkflow={(childWorkflowId) =>
            updateWorkflowSelection('child', childWorkflowId)
          }
        />
      ) : null}

      <ChainWorkflowDialog
        isOpen={isChainDialogOpen}
        onOpenChange={setIsChainDialogOpen}
        sourceWorkflowId={workflowId}
        defaultPlaybookId={workflowQuery.data?.playbook_id ?? undefined}
        defaultWorkflowName={workflowQuery.data?.name ?? 'Workflow'}
      />
    </section>
  );
}

function ResolvedModelResolutionList(props: {
  effectiveModels: Record<string, DashboardEffectiveModelResolution>;
}): JSX.Element {
  const entries = Object.entries(props.effectiveModels);
  if (entries.length === 0) {
    return <p className="text-sm text-muted">No resolved model information is available.</p>;
  }

  return (
    <div className="grid gap-3">
      {entries.map(([role, resolution]) => (
        <div key={role} className="grid gap-3 rounded-lg border border-border/70 bg-border/10 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-foreground">{role}</strong>
            <Badge variant="secondary">{resolution.source}</Badge>
            {resolution.fallback ? <Badge variant="destructive">fallback</Badge> : null}
          </div>
          {resolution.resolved ? (
            <p className="text-sm text-muted">
              {resolution.resolved.provider.name} / {resolution.resolved.model.modelId}
            </p>
          ) : (
            <p className="text-sm text-muted">No resolved model available.</p>
          )}
          {resolution.fallback_reason ? (
            <p className="text-sm text-red-600">{resolution.fallback_reason}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function WorkflowSignalTile(props: {
  label: string;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="grid gap-1 rounded-xl border border-border/70 bg-background/90 p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
        {props.label}
      </p>
      <strong className="text-2xl font-semibold text-foreground">{props.value}</strong>
      <p className="text-sm text-muted">{props.detail}</p>
    </div>
  );
}

function mergeTimelineEntriesWithWorkflowRelations(
  timelineEntries: DashboardProjectTimelineEntry[],
  childRelations: DashboardWorkflowRelationRef[],
): DashboardProjectTimelineEntry[] {
  if (childRelations.length === 0) {
    return timelineEntries;
  }

  const timelineByWorkflowId = new Map(
    timelineEntries.map((entry) => [entry.workflow_id, entry] as const),
  );

  for (const child of childRelations) {
    if (timelineByWorkflowId.has(child.workflow_id)) {
      continue;
    }
    timelineByWorkflowId.set(child.workflow_id, {
      workflow_id: child.workflow_id,
      name: child.name ?? child.workflow_id,
      state: child.state,
      created_at: child.created_at ?? new Date(0).toISOString(),
      started_at: child.started_at ?? null,
      completed_at: child.completed_at ?? null,
      workflow_relations: {
        parent: null,
        children: [],
        latest_child_workflow_id: null,
        child_status_counts: {
          total: 0,
          active: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
        },
      },
      chain: {
        source: 'workflow_relations',
        is_terminal: child.is_terminal,
      },
      link: child.link,
    });
  }

  return Array.from(timelineByWorkflowId.values()).sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  );
}
