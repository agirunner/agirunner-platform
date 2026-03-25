import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';

import {
  dashboardApi,
  type DashboardEffectiveModelResolution,
  type DashboardRoleModelOverride,
  type DashboardWorkflowRelationRef,
  type DashboardWorkflowActivationRecord,
  type DashboardWorkflowModelOverridesResponse,
  type DashboardWorkflowBoardResponse,
  type DashboardWorkflowRecord,
  type DashboardWorkflowResolvedModelsResponse,
  type DashboardWorkflowStageRecord,
  type DashboardWorkspaceRecord,
  type DashboardWorkspaceTimelineEntry,
  type DashboardResolvedDocumentReference,
  type DashboardResolvedConfigResponse,
} from '../../lib/api.js';
import { buildWorkspaceArtifactBrowserPath } from '../../lib/artifact-navigation.js';
import { subscribeToEvents } from '../../lib/sse.js';
import {
  deriveWorkflowRoleOptions,
  groupTasksByStage,
  readPacketNestedKeys,
  readPacketScalarFacts,
  readWorkflowWorkspaceId,
  readWorkspaceMemoryEntries,
  readWorkflowRunSummary,
  summarizeConfigLayers,
  shouldInvalidateWorkflowRealtimeEvent,
  summarizeTasks,
  type DashboardWorkflowTaskRow,
} from './workflow-detail-support.js';
import {
  buildStructuredObject,
  createStructuredEntryDraft,
  objectToStructuredDrafts,
  type StructuredEntryDraft,
} from '../workspace-detail/workspace-detail-support.js';
import {
  buildWorkItemMetadata,
  normalizeWorkItemPriority,
  validateWorkItemMetadataEntries,
  WORK_ITEM_PRIORITY_OPTIONS,
  type WorkItemPriority,
} from './workflow-work-item-form-support.js';
import { WorkItemMetadataEditor } from './workflow-work-item-metadata-editor.js';
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
  WorkspaceTimelineCard,
  TaskGraphCard,
  WorkflowActivationsCard,
  WorkflowStagesCard,
} from './workflow-detail-sections.js';
import {
  buildTimelineContext,
  describeTimelineEvent,
  WorkflowInteractionTimelineCard,
} from './workflow-history-card.js';
import {
  WorkflowClosureCalloutsCard,
  WorkflowDocumentsCard,
  WorkspaceMemoryCard,
} from './workflow-detail-content.js';
import { invalidateWorkflowQueries } from './workflow-detail-query.js';
import { deriveWorkflowStageDisplay } from './workflow-detail-stage-presentation.js';
import { WorkflowSurfaceRecoveryState } from './workflow-surface-recovery-state.js';
import { formatUsdDisplay } from './workflow-ux-formatting.js';
import { ChainWorkflowDialog } from '../../components/chain-workflow/chain-workflow-dialog.js';
import {
  CopyableIdBadge,
  OperatorStatusBadge,
  RelativeTimestamp,
} from '../../components/operator-display/operator-display.js';
import { StructuredRecordView } from '../../components/structured-data/structured-data.js';
import { WorkflowBudgetCard } from '../../components/workflow-budget-card/workflow-budget-card.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { Textarea } from '../../components/ui/textarea.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';

interface TaskListResult {
  data: DashboardWorkflowTaskRow[];
}

function decodeWorkflowDetailTargetId(hash: string): string | null {
  if (!hash) {
    return null;
  }
  const targetId = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!targetId) {
    return null;
  }
  try {
    return decodeURIComponent(targetId);
  } catch {
    return targetId;
  }
}

function readActiveWorkflowDetailTargetId(selection: {
  hash: string;
  selectedWorkItemId: string | null;
  selectedActivationId: string | null;
  selectedChildWorkflowId: string | null;
  selectedGateStageName: string | null;
}): string | null {
  const hashTargetId = decodeWorkflowDetailTargetId(selection.hash);
  if (hashTargetId) {
    return hashTargetId;
  }
  if (selection.selectedWorkItemId) {
    return `work-item-${selection.selectedWorkItemId}`;
  }
  if (selection.selectedActivationId) {
    return `activation-${selection.selectedActivationId}`;
  }
  if (selection.selectedChildWorkflowId) {
    return `child-workflow-${selection.selectedChildWorkflowId}`;
  }
  if (selection.selectedGateStageName) {
    return `gate-${selection.selectedGateStageName}`;
  }
  return null;
}

function hasExplicitWorkflowDetailSelection(selection: {
  hash: string;
  selectedWorkItemId: string | null;
  selectedActivationId: string | null;
  selectedChildWorkflowId: string | null;
  selectedGateStageName: string | null;
}): boolean {
  return Boolean(
    decodeWorkflowDetailTargetId(selection.hash) ||
      selection.selectedWorkItemId ||
      selection.selectedActivationId ||
      selection.selectedChildWorkflowId ||
      selection.selectedGateStageName,
  );
}

function focusWorkflowDetailTarget(targetId: string): boolean {
  const target = document.getElementById(targetId);
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const focusTarget =
    target.querySelector<HTMLElement>('[data-workflow-focus-anchor="true"]') ?? target;
  target.scrollIntoView({ block: 'start' });
  focusTarget.focus({ preventScroll: true });
  return true;
}

function readWorkflowDetailScrollContainer(): HTMLElement | Window {
  const main = document.querySelector('main');
  return main instanceof HTMLElement ? main : window;
}

function scrollWorkflowDetailToTop(): void {
  const container = readWorkflowDetailScrollContainer();
  container.scrollTo({ top: 0, left: 0 });
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
  const [workItemAcceptanceCriteria, setWorkItemAcceptanceCriteria] = useState('');
  const [workItemNotes, setWorkItemNotes] = useState('');
  const [workItemPriority, setWorkItemPriority] = useState<WorkItemPriority>(
    normalizeWorkItemPriority(undefined),
  );
  const [workItemMetadataDrafts, setWorkItemMetadataDrafts] = useState<
    StructuredEntryDraft[]
  >([]);
  const [workItemError, setWorkItemError] = useState<string | null>(null);
  const [isChainDialogOpen, setIsChainDialogOpen] = useState(false);
  const [isCreateWorkItemDialogOpen, setIsCreateWorkItemDialogOpen] = useState(false);
  const [primarySurface, setPrimarySurface] = useState<'board' | 'controls' | 'review'>('board');
  const [secondarySurface, setSecondarySurface] = useState<
    'context' | 'knowledge' | 'activity'
  >('context');
  const lastFocusedTargetIdRef = useRef<string | null>(null);
  const selectedWorkItemId = searchParams.get('work_item');
  const selectedActivationId = searchParams.get('activation');
  const selectedChildWorkflowId = searchParams.get('child');
  const selectedGateStageName = searchParams.get('gate');

  const workflowQuery = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: () => dashboardApi.getWorkflow(workflowId) as Promise<DashboardWorkflowRecord>,
    enabled: workflowId.length > 0,
  });
  const budgetQuery = useQuery({
    queryKey: ['workflow-budget', workflowId],
    queryFn: () => dashboardApi.getWorkflowBudget(workflowId),
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

  const workspaceId = readWorkflowWorkspaceId(workflowQuery.data);
  const workspaceQuery = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => dashboardApi.getWorkspace(workspaceId ?? '') as Promise<DashboardWorkspaceRecord>,
    enabled: Boolean(workspaceId),
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
    queryKey: ['workspace-timeline', workspaceId],
    queryFn: () =>
      dashboardApi.getWorkspaceTimeline(workspaceId ?? '') as Promise<DashboardWorkspaceTimelineEntry[]>,
    enabled: Boolean(workspaceId),
  });

  useEffect(() => {
    lastFocusedTargetIdRef.current = null;
  }, [workflowId]);

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
    if (workItems.length === 0) {
      if (selectedWorkItemId !== null) {
        clearWorkflowSelection('work_item');
      }
      return;
    }
    if (selectedWorkItemId && workItems.some((item) => item.id === selectedWorkItemId)) {
      return;
    }
    if (selectedWorkItemId !== null) {
      clearWorkflowSelection('work_item');
    }
  }, [boardQuery.data, selectedWorkItemId]);

  useEffect(() => {
    if (!workflowId) {
      return;
    }

    return subscribeToEvents((eventType, payload) => {
      if (!shouldInvalidateWorkflowRealtimeEvent(eventType, workflowId, payload)) {
        return;
      }
      void invalidateWorkflowQueries(queryClient, workflowId, workspaceId);
    });
  }, [workflowId, workspaceId, queryClient]);

  useEffect(() => {
    if (selectedChildWorkflowId) {
      setSecondarySurface('activity');
      return;
    }
    const targetId = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    if (targetId.startsWith('child-')) {
      setSecondarySurface('activity');
    }
  }, [location.hash, selectedChildWorkflowId]);

  useEffect(() => {
    if (selectedActivationId || selectedGateStageName) {
      setPrimarySurface('review');
      return;
    }
    if (selectedWorkItemId) {
      setPrimarySurface('board');
    }
  }, [selectedActivationId, selectedGateStageName, selectedWorkItemId]);

  const summary = useMemo(() => summarizeTasks(taskQuery.data?.data ?? []), [taskQuery.data?.data]);
  const historyEvents = useMemo(
    () => historyQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [historyQuery.data],
  );
  const timelineContext = useMemo(
    () =>
      buildTimelineContext({
        activations: activationsQuery.data ?? [],
        childWorkflows: workflowQuery.data?.workflow_relations?.children ?? [],
        stages: stagesQuery.data ?? [],
        tasks: taskQuery.data?.data ?? [],
        workItems: boardQuery.data?.work_items ?? [],
      }),
    [
      activationsQuery.data,
      boardQuery.data?.work_items,
      stagesQuery.data,
      taskQuery.data?.data,
      workflowQuery.data?.workflow_relations?.children,
    ],
  );
  const latestActivitySummary = useMemo(() => {
    const latestEvent = historyEvents[0];
    if (!latestEvent) {
      return null;
    }
    const descriptor = describeTimelineEvent(latestEvent, timelineContext);
    return descriptor.summary ? `${descriptor.headline} — ${descriptor.summary}` : descriptor.headline;
  }, [historyEvents, timelineContext]);
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
    const shouldUseCurrentStageFallback = workflowQuery.data?.lifecycle !== 'ongoing';
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
  const ownerRoleOptions = useMemo(
    () =>
      deriveWorkflowRoleOptions({
        tasks: taskQuery.data?.data ?? [],
        workItems: boardQuery.data?.work_items ?? [],
        effectiveModels: resolvedModelsQuery.data?.effective_models,
        workflowModelOverrides: workflowModelOverridesQuery.data?.model_overrides,
      }),
    [
      boardQuery.data?.work_items,
      resolvedModelsQuery.data?.effective_models,
      taskQuery.data?.data,
      workflowModelOverridesQuery.data?.model_overrides,
    ],
  );
  const stageDisplay = useMemo(
    () => deriveWorkflowStageDisplay(workflowQuery.data),
    [workflowQuery.data],
  );
  const memoryEntries = useMemo(
    () => readWorkspaceMemoryEntries(workspaceQuery.data),
    [workspaceQuery.data],
  );
  const workspaceTimelineEntries = useMemo(
    () =>
      mergeTimelineEntriesWithWorkflowRelations(
        timelineQuery.data ?? [],
        workflowQuery.data?.workflow_relations?.children ?? [],
      ),
    [timelineQuery.data, workflowQuery.data?.workflow_relations?.children],
  );
  const workItemMetadataValidation = useMemo(
    () => validateWorkItemMetadataEntries(workItemMetadataDrafts),
    [workItemMetadataDrafts],
  );
  const activeFocusTargetId = useMemo(
    () =>
      readActiveWorkflowDetailTargetId({
        hash: location.hash,
        selectedWorkItemId,
        selectedActivationId,
        selectedChildWorkflowId,
        selectedGateStageName,
      }),
    [
      location.hash,
      selectedActivationId,
      selectedChildWorkflowId,
      selectedGateStageName,
      selectedWorkItemId,
    ],
  );
  const shouldPreserveWorkflowDetailScroll = useMemo(
    () =>
      hasExplicitWorkflowDetailSelection({
        hash: location.hash,
        selectedWorkItemId,
        selectedActivationId,
        selectedChildWorkflowId,
        selectedGateStageName,
      }),
    [
      location.hash,
      selectedActivationId,
      selectedChildWorkflowId,
      selectedGateStageName,
      selectedWorkItemId,
    ],
  );

  useEffect(() => {
    if (!activeFocusTargetId) {
      lastFocusedTargetIdRef.current = null;
      return;
    }
    if (lastFocusedTargetIdRef.current === activeFocusTargetId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (focusWorkflowDetailTarget(activeFocusTargetId)) {
        lastFocusedTargetIdRef.current = activeFocusTargetId;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeFocusTargetId,
    activationsQuery.data?.length,
    boardQuery.data?.columns.length,
    workspaceTimelineEntries.length,
    selectedWorkItemId,
    stagesQuery.data?.length,
  ]);

  useEffect(() => {
    if (!workflowId || shouldPreserveWorkflowDetailScroll) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      scrollWorkflowDetailToTop();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.key, location.pathname, location.search, shouldPreserveWorkflowDetailScroll, workflowId]);

  if (workflowQuery.data && !workflowQuery.data.playbook_id) {
    return (
      <section className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Workflow Unavailable</CardTitle>
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
    if (!workspaceId) {
      setMemoryError('Workspace memory is only available for workspace-backed workflows.');
      return;
    }
    if (!memoryKey.trim()) {
      setMemoryError('Memory key must not be empty.');
      return;
    }
    try {
      parsedValue = buildStructuredObject(memoryDrafts, 'Workspace memory');
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
    await dashboardApi.patchWorkspaceMemory(workspaceId, {
      key: memoryKey.trim(),
      value: parsedValue,
    });
    setMemoryMessage(`Updated workspace memory key '${memoryKey.trim()}'.`);
    await invalidateWorkflowQueries(queryClient, workflowId, workspaceId);
  }

  const createWorkItemMutation = useMutation({
    mutationFn: async () => {
      if (!workItemTitle.trim()) {
        throw new Error('Work item title is required.');
      }
      const metadata = buildWorkItemMetadata(workItemMetadataDrafts);
      return dashboardApi.createWorkflowWorkItem(workflowId, {
        title: workItemTitle.trim(),
        goal: workItemGoal.trim() || undefined,
        acceptance_criteria: workItemAcceptanceCriteria.trim() || undefined,
        stage_name: workItemStage || undefined,
        priority: workItemPriority,
        notes: workItemNotes.trim() || undefined,
        metadata,
      });
    },
    onSuccess: async (createdWorkItem) => {
      setWorkItemTitle('');
      setWorkItemGoal('');
      setWorkItemAcceptanceCriteria('');
      setWorkItemNotes('');
      setWorkItemPriority(normalizeWorkItemPriority(undefined));
      setWorkItemMetadataDrafts([]);
      setWorkItemError(null);
      setIsCreateWorkItemDialogOpen(false);
      setPrimarySurface('board');
      updateWorkflowSelection('work_item', createdWorkItem.id);
      await invalidateWorkflowQueries(queryClient, workflowId, workspaceId);
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
  const canEnqueueManualActivation = Boolean(
    workflowQuery.data &&
      ['active', 'paused'].includes(workflowQuery.data.state) &&
      workflowQuery.data.playbook_id,
  );
  const selectedPriorityLabel =
    WORK_ITEM_PRIORITY_OPTIONS.find((option) => option.value === workItemPriority)?.label ??
    'Normal';

  return (
    <section className="mx-auto grid w-full max-w-[1600px] gap-6 px-4 py-5 lg:px-6 xl:px-8">
      <section data-testid="workflow-detail-operator-surface" className="grid gap-6">
        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.7fr)]">
          <Card className="overflow-hidden border-border/80 bg-card shadow-md">
            <CardHeader className="gap-4 border-b border-border/70 bg-gradient-to-br from-surface via-surface to-border/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>Workflow</CardTitle>
                  <CardDescription>
                    Live operator view of the workflow, board state, and orchestration context.
                  </CardDescription>
                </div>
                {workflowQuery.data ? (
                  <div className="flex flex-wrap gap-2">
                    <OperatorStatusBadge status={workflowQuery.data.state} />
                    {isPlaybookWorkflow && stageDisplay.badgeValue ? (
                      <Badge variant="secondary">
                        {stageDisplay.label}: {stageDisplay.badgeValue}
                      </Badge>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 p-4">
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
                  <div className="grid gap-4 rounded-2xl border border-border/70 bg-border/10 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="space-y-3">
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
                          {workflowQuery.data.workspace_id ? ' linked to a workspace.' : '.'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {workflowQuery.data.playbook_name ? (
                          <Badge variant="outline">{workflowQuery.data.playbook_name}</Badge>
                        ) : null}
                        {workflowQuery.data.lifecycle ? (
                          <Badge variant="secondary">{workflowQuery.data.lifecycle}</Badge>
                        ) : null}
                        {workflowQuery.data.workspace_id ? (
                          <Badge variant="outline">Workspace-linked</Badge>
                        ) : null}
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/mission-control/workflows/${workflowId}/inspector`}>Open Inspector</Link>
                        </Button>
                        {workspaceId ? (
                          <Button asChild size="sm" variant="outline">
                            <Link
                              to={buildWorkspaceArtifactBrowserPath(workspaceId, {
                                workflowId,
                              })}
                            >
                              Workflow Artifacts
                            </Link>
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
                          value={formatUsdDisplay(costSummary.totalCostUsd)}
                          detail="total run cost"
                        />
                      </div>
                    </div>
                    <dl className="grid gap-3 rounded-xl border border-border/70 bg-surface/80 p-4 text-sm">
                      <div className="grid gap-1">
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                          Workflow ID
                        </dt>
                        <dd>
                          <CopyableIdBadge value={workflowQuery.data.id} label="Board" />
                        </dd>
                      </div>
                      <div className="grid gap-1">
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                          Created
                        </dt>
                        <dd>
                          <RelativeTimestamp
                            value={workflowQuery.data.created_at}
                            prefix="Created"
                            className="text-sm text-foreground"
                          />
                        </dd>
                      </div>
                      <div className="grid gap-1">
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                          Stage Signal
                        </dt>
                        <dd className="text-foreground">{stageDisplay.detailValue}</dd>
                      </div>
                      <div className="grid gap-1">
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                          Workspace
                        </dt>
                        <dd className="text-foreground">
                          {workspaceQuery.data?.name ?? (workflowQuery.data.workspace_id ? 'Linked workspace' : 'Standalone workflow')}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid content-start gap-6">
            <MissionControlCard
              workflow={{
                id: workflowId,
                state: workflowQuery.data?.state,
                workspace_id: workspaceId,
              }}
              summary={summary}
              workItemSummary={workflowQuery.data?.work_item_summary}
              totalCostUsd={costSummary.totalCostUsd}
              latestActivitySummary={latestActivitySummary ?? undefined}
            />
            <WorkflowBudgetCard
              workflowId={workflowId}
              budget={budgetQuery.data}
              isLoading={budgetQuery.isLoading}
              hasError={Boolean(budgetQuery.error)}
              context="workflow-detail"
            />
            <WorkflowClosureCalloutsCard
              workflow={workflowQuery.data}
              workItems={workflowQuery.data?.work_items ?? []}
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
          <section className="grid gap-4 rounded-3xl border border-border/70 bg-card/70 p-4 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="space-y-2">
                <Badge variant="outline" className="w-fit">
                  Board workspace
                </Badge>
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold text-foreground">
                    Triage the board first
                  </h2>
                  <p className="max-w-3xl text-sm leading-6 text-muted">
                    Scan the board for blocked work, waiting gates, and ownership gaps. Open a
                    focused work-item rail only when you need routing, review, or evidence.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 xl:max-w-[34rem] xl:justify-end">
                <Badge variant="outline">
                  {selectedWorkItemId ? 'Focused work-item rail' : 'Broad triage mode'}
                </Badge>
                <Badge variant="outline">
                  {`${workItemSummary?.open_work_item_count ?? 0} open • ${workItemSummary?.awaiting_gate_count ?? 0} waiting gates`}
                </Badge>
              </div>
            </div>

            <Tabs
              value={primarySurface}
              onValueChange={(value) =>
                setPrimarySurface(value as 'board' | 'controls' | 'review')
              }
              className="grid gap-4"
            >
              <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-xl border border-border/70 bg-border/10 p-1 lg:grid-cols-3">
                <TabsTrigger value="board">Board &amp; triage</TabsTrigger>
                <TabsTrigger value="controls">Run controls</TabsTrigger>
                <TabsTrigger value="review">Gates &amp; activations</TabsTrigger>
              </TabsList>

              <TabsContent value="board" className="mt-0 grid gap-5">
                <div
                  className={
                    selectedWorkItemId
                      ? 'grid gap-6 xl:grid-cols-[minmax(0,2.15fr)_minmax(20rem,23rem)] 2xl:grid-cols-[minmax(0,2.3fr)_minmax(21rem,24rem)]'
                      : 'grid gap-6'
                  }
                >
                  <section className="rounded-3xl border border-border/70 bg-card/70 p-4 shadow-sm">
                    <PlaybookBoardCard
                      workflowId={workflowId}
                      board={boardQuery.data}
                      stages={stagesQuery.data ?? []}
                      isLoading={boardQuery.isLoading}
                      hasError={Boolean(boardQuery.error)}
                      selectedWorkItemId={selectedWorkItemId}
                      onSelectWorkItem={(workItemId) => updateWorkflowSelection('work_item', workItemId)}
                      onBoardChanged={() =>
                        invalidateWorkflowQueries(queryClient, workflowId, workspaceId)
                      }
                    />
                  </section>

                  {selectedWorkItemId ? (
                    <aside
                      id={`work-item-${selectedWorkItemId}`}
                      className="grid content-start gap-3 rounded-3xl border border-accent/20 bg-accent/5 p-4 shadow-sm xl:sticky xl:top-6 xl:w-full xl:max-w-[24rem] xl:justify-self-end xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto"
                      data-testid="selected-work-item-rail"
                      aria-label="Selected work-item focus"
                    >
                      <WorkflowWorkItemDetailPanel
                        workflowId={workflowId}
                        workItemId={selectedWorkItemId}
                        workItems={groupedWorkItems}
                        selectedWorkItem={selectedBoardWorkItem}
                        columns={boardQuery.data?.columns ?? []}
                        stages={stagesQuery.data ?? []}
                        ownerRoleOptions={ownerRoleOptions}
                        tasks={selectedWorkItemTasks}
                        onSelectWorkItem={(workItemId) => updateWorkflowSelection('work_item', workItemId)}
                        onWorkItemChanged={() =>
                          invalidateWorkflowQueries(queryClient, workflowId, workspaceId)
                        }
                        onClearSelection={() => clearWorkflowSelection('work_item')}
                      />
                    </aside>
                  ) : (
                    <Card
                      className="border-dashed border-border/70 bg-border/5 shadow-none"
                      data-testid="workflow-board-guide-state"
                    >
                      <CardHeader className="gap-2 py-4">
                        <CardTitle>Board triage mode</CardTitle>
                        <CardDescription>
                          Keep the board wide while you scan flow across stages. Select a card only
                          when you need its focused packet for routing, review, or evidence.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-wrap gap-2 pt-0">
                        <Badge variant="secondary">Select a card to open the rail</Badge>
                        <Badge variant="outline">Review gates in the review tab</Badge>
                        <Badge variant="outline">Create new work from run controls</Badge>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="controls" className="mt-0 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,20rem)]">
                <Card className="bg-surface/80">
                  <CardHeader>
                    <CardTitle>Quick-create work item</CardTitle>
                    <CardDescription>
                      Open the guided create flow only when you are ready to add another board item.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{`Stage: ${workItemStage || 'Auto'}`}</Badge>
                      <Badge variant="outline">{`Priority: ${selectedPriorityLabel}`}</Badge>
                      <Badge variant="outline">Structured metadata</Badge>
                    </div>
                    <p className="text-sm leading-6 text-muted">
                      Keep the board focused on triage. Use the full create form only when you need
                      to add work.
                    </p>
                    <div className="flex justify-end">
                      <Button onClick={() => setIsCreateWorkItemDialogOpen(true)}>
                        Create Work Item
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-surface/80">
                  <CardHeader>
                    <CardTitle>Launch Child Board</CardTitle>
                    <CardDescription>
                      Create a linked follow-up board run and preserve lineage.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">Lineage preserved</Badge>
                      <Badge variant="outline">Parent context carried forward</Badge>
                    </div>
                    <p className="text-sm leading-6 text-muted">
                      Open the child-board flow only when this board needs a separate downstream
                      run.
                    </p>
                    <div className="flex justify-end">
                      <Button onClick={() => setIsChainDialogOpen(true)}>Create Child Board</Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="review" className="mt-0 grid gap-6 xl:grid-cols-2">
                <WorkflowStagesCard
                  stages={stagesQuery.data ?? []}
                  isLoading={stagesQuery.isLoading}
                  hasError={Boolean(stagesQuery.error)}
                  selectedGateStageName={selectedGateStageName}
                  onSelectGate={(stageName) => updateWorkflowSelection('gate', stageName)}
                />
                <WorkflowActivationsCard
                  workflowId={workflowId}
                  workflowState={workflowQuery.data?.state}
                  activations={activationsQuery.data ?? []}
                  isLoading={activationsQuery.isLoading}
                  hasError={Boolean(activationsQuery.error)}
                  canEnqueueManualActivation={canEnqueueManualActivation}
                  selectedActivationId={selectedActivationId}
                  onSelectActivation={(activationId) =>
                    updateWorkflowSelection('activation', activationId)
                  }
                  onActivationQueued={() =>
                    invalidateWorkflowQueries(queryClient, workflowId, workspaceId)
                  }
                />
              </TabsContent>
            </Tabs>
          </section>
        ) : null}
      </section>

      <section
        className="grid gap-4 rounded-3xl border border-border/70 bg-card/70 p-4 shadow-sm"
        data-testid="workflow-secondary-tabs"
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit">
              Operator deep dives
            </Badge>
            <div className="space-y-1">
              <h2 className="text-xl font-semibold text-foreground">
                Context, knowledge, and activity
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-muted">
                Keep the live board and selected work-item flow above. Use these tabs when you
                need the run packet, shared knowledge, or execution trail without turning the
                primary surface into a long text dump.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 xl:max-w-[42rem] xl:justify-end">
            <Badge variant="outline">Run packets on demand</Badge>
            <Badge variant="outline">{`${documentQuery.data?.length ?? 0} docs • ${memoryEntries.length} memory entries`}</Badge>
            <Badge variant="outline">{`${historyEvents.length} events • ${taskQuery.data?.data?.length ?? 0} steps`}</Badge>
          </div>
        </div>

        <Tabs
          value={secondarySurface}
          onValueChange={(value) =>
            setSecondarySurface(value as 'context' | 'knowledge' | 'activity')
          }
          className="grid gap-4"
        >
          <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-xl border border-border/70 bg-border/10 p-1 md:grid-cols-3">
            <TabsTrigger value="context">Run packets</TabsTrigger>
            <TabsTrigger value="knowledge">Knowledge base</TabsTrigger>
            <TabsTrigger value="activity">Execution &amp; activity</TabsTrigger>
          </TabsList>

          <TabsContent value="context" className="mt-0 grid gap-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <Card className="border-border/70 bg-card/80 shadow-sm">
                <CardHeader>
                  <CardTitle>Operator Context</CardTitle>
                  <CardDescription>
                    Shared context, run parameters, and orchestration metadata attached to this
                    board run.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <WorkflowContextPacket context={workflowQuery.data?.context} />
                </CardContent>
              </Card>

              <Card className="border-border/70 bg-card/80 shadow-sm">
                <CardHeader>
                  <CardTitle>Model Overrides</CardTitle>
                  <CardDescription>
                    Board-run overrides take precedence over workspace-level model settings.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {workflowModelOverridesQuery.isLoading ? (
                    <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
                      Loading model overrides...
                    </p>
                  ) : null}
                  {workflowModelOverridesQuery.error ? (
                    <WorkflowSurfaceRecoveryState
                      title="Board model overrides are unavailable"
                      detail="The board override packet did not load. Retry this run-packets lane before you assume specialists are inheriting the wrong models."
                      onRetry={() => {
                        void workflowModelOverridesQuery.refetch();
                      }}
                      actionLabel="Retry overrides"
                    />
                  ) : null}
                  {workflowModelOverridesQuery.data ? (
                    <WorkflowModelOverridesPacket
                      overrides={workflowModelOverridesQuery.data.model_overrides}
                      effectiveModels={resolvedModelsQuery.data?.effective_models ?? {}}
                    />
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Card className="border-border/70 bg-card/80 shadow-sm">
                <CardHeader>
                  <CardTitle>Effective Models</CardTitle>
                  <CardDescription>
                    Resolved models after applying defaults, workspace overrides, and workflow
                    launch overrides.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {resolvedModelsQuery.isLoading ? (
                    <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
                      Resolving effective models...
                    </p>
                  ) : null}
                  {resolvedModelsQuery.error ? (
                    <WorkflowSurfaceRecoveryState
                      title="Effective models could not be resolved"
                      detail="This board run may still be resolving model defaults, or the resolution request failed. Retry before reviewing role-level model coverage from this tab."
                      onRetry={() => {
                        void resolvedModelsQuery.refetch();
                      }}
                      actionLabel="Retry model resolution"
                    />
                  ) : null}
                  {resolvedModelsQuery.data ? (
                    <ResolvedModelResolutionList
                      effectiveModels={resolvedModelsQuery.data.effective_models}
                    />
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-border/70 bg-card/80 shadow-sm">
                <CardHeader>
                  <CardTitle>Resolved Config</CardTitle>
                  <CardDescription>
                    Merged playbook, workspace, and board-run configuration for this operator
                    surface.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {configQuery.isLoading ? (
                    <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
                      Loading config...
                    </p>
                  ) : null}
                  {configQuery.error ? (
                    <WorkflowSurfaceRecoveryState
                      title="Resolved board configuration is unavailable"
                      detail="The merged playbook, workspace, and board-run config packet failed to load. Retry before validating launch inputs or escalation settings from this surface."
                      onRetry={() => {
                        void configQuery.refetch();
                      }}
                      actionLabel="Retry config"
                    />
                  ) : null}
                  {configQuery.data ? (
                    <WorkflowConfigReviewPacket config={configQuery.data} />
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <Card className="border-border/70 bg-card/80 shadow-sm">
              <CardHeader>
                <CardTitle>Board Summary</CardTitle>
                <CardDescription>
                  Continuity summary written into workspace memory when the board run reaches a
                  terminal state.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {runSummary ? (
                  <WorkflowRunSummaryPacket summary={runSummary} />
                ) : (
                  <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
                    Run summary becomes available after the workflow reaches terminal state.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="knowledge" className="mt-0 grid gap-6 xl:grid-cols-2">
            <WorkflowDocumentsCard
              workflowId={workflowId}
              isLoading={documentQuery.isLoading}
              hasError={Boolean(documentQuery.error)}
              onRetry={() => {
                void documentQuery.refetch();
              }}
              documents={documentQuery.data ?? []}
              tasks={taskQuery.data?.data ?? []}
              areTasksLoading={taskQuery.isLoading}
              hasTasksError={Boolean(taskQuery.error)}
            />

            <WorkspaceMemoryCard
              workspace={workspaceQuery.data}
              entries={memoryEntries}
              isLoading={workspaceQuery.isLoading}
              hasError={Boolean(workspaceQuery.error)}
              memoryKey={memoryKey}
              memoryDrafts={memoryDrafts}
              memoryError={memoryError}
              memoryMessage={memoryMessage}
              onMemoryKeyChange={setMemoryKey}
              onMemoryDraftsChange={setMemoryDrafts}
              onSave={() => void handleMemorySave()}
            />
          </TabsContent>

          <TabsContent value="activity" className="mt-0 grid gap-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <TaskGraphCard
                tasks={taskQuery.data?.data ?? []}
                stageGroups={stageGroups}
                isLoading={taskQuery.isLoading}
                hasError={Boolean(taskQuery.error)}
              />

              <WorkflowInteractionTimelineCard
                context={timelineContext}
                workflowId={workflowId}
                isLoading={historyQuery.isLoading}
                hasError={Boolean(historyQuery.error)}
                isLoadingMore={historyQuery.isFetchingNextPage}
                hasMore={historyQuery.hasNextPage}
                onRetry={() => {
                  void historyQuery.refetch();
                }}
                onLoadMore={() => void historyQuery.fetchNextPage()}
                events={historyEvents}
              />
            </div>

            {workspaceId ? (
              <WorkspaceTimelineCard
                isLoading={timelineQuery.isLoading}
                hasError={Boolean(timelineQuery.error)}
                entries={workspaceTimelineEntries}
                currentWorkflowId={workflowId}
                selectedChildWorkflowId={selectedChildWorkflowId}
                onSelectChildWorkflow={(childWorkflowId) =>
                  updateWorkflowSelection('child', childWorkflowId)
                }
              />
            ) : null}
          </TabsContent>
        </Tabs>
      </section>

      <ChainWorkflowDialog
        isOpen={isChainDialogOpen}
        onOpenChange={setIsChainDialogOpen}
        sourceWorkflowId={workflowId}
        defaultPlaybookId={workflowQuery.data?.playbook_id ?? undefined}
        defaultWorkflowName={workflowQuery.data?.name ?? 'Workflow'}
      />
      <Dialog
        open={isCreateWorkItemDialogOpen}
        onOpenChange={(isOpen) => {
          setIsCreateWorkItemDialogOpen(isOpen);
          if (isOpen) {
            return;
          }
          setWorkItemError(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Work Item</DialogTitle>
            <DialogDescription>
              Add new work directly onto the playbook board with a stage-aware form.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
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
                  onValueChange={(value) => {
                    setWorkItemError(null);
                    setWorkItemStage(value === '__auto__' ? '' : value);
                  }}
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
            </div>
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
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-foreground">Priority</span>
                <Select
                  value={workItemPriority}
                  onValueChange={(value) => {
                    setWorkItemError(null);
                    setWorkItemPriority(normalizeWorkItemPriority(value));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    {WORK_ITEM_PRIORITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted">
                  {WORK_ITEM_PRIORITY_OPTIONS.find((option) => option.value === workItemPriority)
                    ?.description ?? ''}
                </p>
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-foreground">Acceptance criteria</span>
                <Textarea
                  value={workItemAcceptanceCriteria}
                  onChange={(event) => {
                    setWorkItemError(null);
                    setWorkItemAcceptanceCriteria(event.target.value);
                  }}
                  className="min-h-[112px]"
                  placeholder="List the conditions that must be true before this work item can be closed."
                />
              </label>
            </div>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-foreground">Notes</span>
              <Textarea
                value={workItemNotes}
                onChange={(event) => {
                  setWorkItemError(null);
                  setWorkItemNotes(event.target.value);
                }}
                className="min-h-[112px]"
                placeholder="Capture operator guidance, context, or follow-up constraints."
              />
            </label>
            <WorkItemMetadataEditor
              title="Structured metadata"
              description="Add supported typed metadata as key and value pairs instead of pasting raw JSON."
              drafts={workItemMetadataDrafts}
              validation={workItemMetadataValidation}
              addLabel="Add Metadata Entry"
              onChange={(drafts) => {
                setWorkItemError(null);
                setWorkItemMetadataDrafts(drafts);
              }}
            />
            {workItemError ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                {workItemError}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button
                onClick={() => void createWorkItemMutation.mutate()}
                disabled={createWorkItemMutation.isPending || !workItemMetadataValidation.isValid}
              >
                {createWorkItemMutation.isPending ? 'Creating…' : 'Create Work Item'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function WorkflowContextPacket(props: {
  context: Record<string, unknown> | null | undefined;
}): JSX.Element {
  const context = asPacketRecord(props.context);
  const contextKeys = Object.keys(context).sort((left, right) => left.localeCompare(right));
  const scalarFacts = readPacketScalarFacts(context, 6);
  const nestedKeys = readPacketNestedKeys(context, 8);

  if (contextKeys.length === 0) {
    return (
      <PacketEmptyState
        title="No workflow context is available yet"
        badge="Waiting for first packet"
        summary="Context appears here after the board run records orchestrator-scoped values."
        detail="When available, this panel becomes the operator-facing packet for shared workflow context, launch parameters, and orchestration metadata."
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <WorkflowSignalTile
          label="Context fields"
          value={String(contextKeys.length)}
          detail="Top-level keys available to the orchestrator"
        />
        <WorkflowSignalTile
          label="Inline values"
          value={String(scalarFacts.length)}
          detail="Immediately readable values without drilling deeper"
        />
        <WorkflowSignalTile
          label="Nested packets"
          value={String(Math.max(contextKeys.length - scalarFacts.length, 0))}
          detail="Structured sections available on demand"
        />
      </div>
      {scalarFacts.length > 0 ? (
        <PacketFactGrid
          title="Immediate context values"
          description="Operator-visible values available without opening the full context packet."
          facts={scalarFacts}
        />
      ) : null}
      {nestedKeys.length > 0 ? (
        <PacketBadgePanel
          title="Structured context sections"
          description="Nested context packets that the orchestrator can inspect on demand."
          badges={nestedKeys}
        />
      ) : null}
      <PacketDisclosure
        summary="Open full operator context"
        data={context}
        emptyMessage="No workflow context is available yet."
      />
    </div>
  );
}

function WorkflowConfigReviewPacket(props: {
  config: DashboardResolvedConfigResponse;
}): JSX.Element {
  const resolvedConfig = asPacketRecord(props.config.resolved_config);
  const resolvedSections = Object.keys(resolvedConfig).sort((left, right) => left.localeCompare(right));
  const configLayers = asPacketRecord(props.config.config_layers);
  const layerSummaries = summarizeConfigLayers(configLayers);
  const scalarFacts = readPacketScalarFacts(resolvedConfig, 4);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <WorkflowSignalTile
          label="Merged sections"
          value={String(resolvedSections.length)}
          detail="Top-level configuration sections in effect"
        />
        <WorkflowSignalTile
          label="Layer sources"
          value={String(layerSummaries.length)}
          detail={
            layerSummaries.length > 0
              ? layerSummaries.map((layer) => layer.name).join(', ')
              : 'No layer breakdown exposed'
          }
        />
        <WorkflowSignalTile
          label="Workflow packet"
          value={props.config.workflow_id}
          detail="Resolved for the current board run"
        />
      </div>
      <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4">
        <div className="text-sm font-medium text-foreground">Resolved config sections</div>
        <div className="flex flex-wrap gap-2">
          {resolvedSections.slice(0, 10).map((section) => (
            <Badge key={section} variant="outline">
              {section}
            </Badge>
          ))}
        </div>
      </div>
      {scalarFacts.length > 0 ? (
        <PacketFactGrid
          title="Resolved inline values"
          description="Immediate workflow config facts surfaced without opening the full merged packet."
          facts={scalarFacts}
        />
      ) : null}
      {layerSummaries.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {layerSummaries.map((layer) => (
            <article
              key={layer.name}
              className="grid gap-2 rounded-xl border border-border/70 bg-background/80 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm text-foreground">{layer.name}</strong>
                <Badge variant="outline">{layer.fieldCount} fields</Badge>
              </div>
              <p className="text-sm leading-6 text-muted">
                {layer.keys.length > 0
                  ? `Includes ${layer.keys.slice(0, 4).join(', ')}.`
                  : 'No top-level fields exposed in this layer.'}
              </p>
            </article>
          ))}
        </div>
      ) : null}
      <PacketDisclosure
        summary="Open merged config"
        data={resolvedConfig}
        emptyMessage="No resolved configuration available."
      />
      {layerSummaries.length > 0 ? (
        <PacketDisclosure
          summary="Open layer breakdown"
          data={configLayers}
          emptyMessage="No layer breakdown available."
        />
      ) : null}
    </div>
  );
}

function WorkflowRunSummaryPacket(props: {
  summary: Record<string, unknown>;
}): JSX.Element {
  const summary = asPacketRecord(props.summary);
  const stageMetrics = asPacketArray(summary.stage_metrics);
  const stageActivity = asPacketArray(summary.stage_activity ?? summary.stage_progression);
  const producedArtifacts = asPacketArray(summary.produced_artifacts);
  const childChain = asPacketRecord(summary.chain);
  const childCounts = asPacketRecord(childChain.child_status_counts);
  const orchestratorAnalytics = asPacketRecord(summary.orchestrator_analytics);
  const scalarFacts = readPacketScalarFacts(summary, 4);
  const stageMetricCards = stageMetrics
    .map((entry) => describeStageMetricCard(entry))
    .filter((entry): entry is { label: string; value: string; detail: string } => entry !== null)
    .slice(0, 4);
  const completedStages = countStageMetricsWithStatus(stageMetrics, 'completed');
  const gateReviewCount = countStageMetricsWithGate(stageMetrics, ['requested', 'changes_requested']);
  const reportedSpendUsd = readPacketNumber(orchestratorAnalytics.total_cost_usd);
  const totalReworkCycles = readPacketNumber(orchestratorAnalytics.total_rework_cycles);
  const childBoardCount = readNumericPacketValue(childCounts.total);
  const outcomeNarrative = describeRunOutcomeNarrative({
    completedStages,
    gateReviewCount,
    producedArtifacts: producedArtifacts.length,
    reportedSpendUsd,
    stageCount: stageMetrics.length,
    childBoardCount,
  });

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4">
        <div className="grid gap-1">
          <div className="text-sm font-medium text-foreground">Run outcome narrative</div>
          <p className="text-sm leading-6 text-muted">
            Judge completion posture, gate pressure, reported spend, and delivered artifacts without opening the raw final packet.
          </p>
        </div>
        <p className="text-sm font-medium text-foreground">{outcomeNarrative}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <WorkflowSignalTile
          label="Board completion"
          value={`${completedStages}/${stageMetrics.length || 0} stages`}
          detail={
            stageMetrics.length > 0
              ? `${stageActivity.length} stage timeline packet${stageActivity.length === 1 ? '' : 's'} captured`
              : 'No stage outcome rows were captured in the final packet.'
          }
        />
        <WorkflowSignalTile
          label="Gate posture"
          value={gateReviewCount === 0 ? 'Clear' : `${gateReviewCount} waiting`}
          detail={
            gateReviewCount === 0
              ? 'No stage gates remained waiting at run completion.'
              : 'Stage gates still needed operator review or requested changes.'
          }
        />
        <WorkflowSignalTile
          label="Reported spend"
          value={formatPacketCurrency(reportedSpendUsd)}
          detail={
            totalReworkCycles > 0
              ? `${totalReworkCycles} rework cycle${totalReworkCycles === 1 ? '' : 's'} were recorded across the board run.`
              : 'No rework cycles were recorded in orchestrator analytics.'
          }
        />
        <WorkflowSignalTile
          label="Artifacts delivered"
          value={String(producedArtifacts.length)}
          detail={
            childBoardCount > 0
              ? `${childBoardCount} child board${childBoardCount === 1 ? '' : 's'} contributed to the final lineage.`
              : 'All delivered outputs came from this board run.'
          }
        />
      </div>
      {scalarFacts.length > 0 ? (
        <PacketFactGrid
          title="Terminal run signals"
          description="Direct summary values captured when the board run reached its terminal state."
          facts={scalarFacts}
        />
      ) : null}
      {stageMetricCards.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {stageMetricCards.map((card) => (
            <WorkflowSignalTile
              key={`${card.label}:${card.value}`}
              label={card.label}
              value={card.value}
              detail={card.detail}
            />
          ))}
        </div>
      ) : null}
      <PacketBadgePanel
        title="Run outcome packet"
        description="Top-level sections captured in the final board summary."
        badges={Object.keys(summary)
          .sort((left, right) => left.localeCompare(right))
          .slice(0, 10)}
      />
      <PacketDisclosure
        summary="Open run outcome packet"
        data={summary}
        emptyMessage="Run summary becomes available after the workflow reaches terminal state."
      />
    </div>
  );
}

function PacketDisclosure(props: {
  summary: string;
  data: Record<string, unknown>;
  emptyMessage: string;
}): JSX.Element {
  return (
    <details className="rounded-xl border border-border/70 bg-background/80 p-4">
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        {props.summary}
      </summary>
      <div className="mt-3">
        <StructuredRecordView data={props.data} emptyMessage={props.emptyMessage} />
      </div>
    </details>
  );
}

function PacketFactGrid(props: {
  title: string;
  description: string;
  facts: Array<{ label: string; value: string }>;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4">
      <div className="grid gap-1">
        <div className="text-sm font-medium text-foreground">{props.title}</div>
        <p className="text-sm leading-6 text-muted">{props.description}</p>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        {props.facts.map((fact) => (
          <div
            key={`${props.title}:${fact.label}`}
            className="grid gap-1 rounded-lg border border-border/70 bg-surface px-3 py-2"
          >
            <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              {fact.label}
            </dt>
            <dd className="text-sm text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function PacketBadgePanel(props: {
  title: string;
  description: string;
  badges: string[];
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4">
      <div className="grid gap-1">
        <div className="text-sm font-medium text-foreground">{props.title}</div>
        <p className="text-sm leading-6 text-muted">{props.description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {props.badges.map((badge) => (
          <Badge key={`${props.title}:${badge}`} variant="outline">
            {badge}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function PacketEmptyState(props: {
  title: string;
  badge: string;
  summary: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-xl border border-dashed border-border/70 bg-border/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-sm font-medium text-foreground">{props.title}</div>
          <p className="text-sm leading-6 text-muted">{props.summary}</p>
        </div>
        <Badge variant="outline">{props.badge}</Badge>
      </div>
      <p className="text-sm leading-6 text-muted">{props.detail}</p>
    </div>
  );
}

function ResolvedModelResolutionList(props: {
  effectiveModels: Record<string, DashboardEffectiveModelResolution>;
}): JSX.Element {
  const entries = Object.entries(props.effectiveModels);
  if (entries.length === 0) {
    return (
      <PacketEmptyState
        title="No resolved model information is available"
        badge="No effective models"
        summary="This board run has not resolved any role-level model selections yet."
        detail="Once defaults and overrides resolve, each role will surface its provider, model, and fallback posture here."
      />
    );
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

function WorkflowModelOverridesPacket(props: {
  overrides: Record<string, DashboardRoleModelOverride>;
  effectiveModels: Record<string, DashboardEffectiveModelResolution>;
}): JSX.Element {
  const entries = Object.entries(props.overrides).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  if (entries.length === 0) {
    return (
      <PacketEmptyState
        title="No board-run model overrides configured"
        badge="Using inherited defaults"
        summary="This board run is currently inheriting model selections from broader defaults."
        detail="Configure workflow-scoped overrides only when this board needs a different role model, provider, or reasoning profile."
      />
    );
  }

  const providerCount = new Set(
    entries
      .map(([, override]) => override.provider)
      .filter((provider) => provider.trim().length > 0),
  ).size;
  const reasoningProfiles = entries.filter(([, override]) =>
    hasStructuredEntries(override.reasoning_config),
  ).length;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <WorkflowSignalTile
          label="Configured override roles"
          value={String(entries.length)}
          detail="Workflow-scoped model selections"
        />
        <WorkflowSignalTile
          label="Providers"
          value={String(providerCount)}
          detail="Distinct providers pinned on this board run"
        />
        <WorkflowSignalTile
          label="Reasoning profiles"
          value={String(reasoningProfiles)}
          detail="Overrides with custom reasoning settings"
        />
      </div>
      <div className="grid gap-3">
        {entries.map(([role, override]) => {
          const effectiveResolution = props.effectiveModels[role];
          return (
            <article
              key={role}
              className="grid gap-4 rounded-xl border border-border/70 bg-border/10 p-4"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="grid gap-1">
                  <strong className="text-foreground">{role}</strong>
                  <p className="text-sm text-muted">
                    {override.provider} / {override.model}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">Workflow override</Badge>
                  {effectiveResolution?.fallback ? (
                    <Badge variant="warning">Fallback active</Badge>
                  ) : null}
                  {hasStructuredEntries(override.reasoning_config) ? (
                    <Badge variant="outline">Custom reasoning</Badge>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <OverridePacketStat
                  label="Requested model"
                  value={override.model}
                  detail={override.provider}
                />
                <OverridePacketStat
                  label="Reasoning profile"
                  value={summarizeReasoningProfile(override.reasoning_config)}
                  detail={
                    hasStructuredEntries(override.reasoning_config)
                      ? 'Workflow-specific reasoning settings'
                      : 'Uses the model default reasoning behavior'
                  }
                />
                <OverridePacketStat
                  label="Effective resolution"
                  value={readEffectiveModelValue(effectiveResolution)}
                  detail={
                    effectiveResolution?.fallback
                      ? effectiveResolution.fallback_reason ?? 'Resolved through fallback handling'
                      : effectiveResolution?.source ?? 'No resolved model available'
                  }
                />
              </div>
              {hasStructuredEntries(override.reasoning_config) ? (
                <div className="grid gap-2 rounded-lg border border-border/70 bg-background/70 p-3">
                  <div className="text-sm font-medium text-foreground">Reasoning settings</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(override.reasoning_config ?? {}).map((key) => (
                      <Badge key={key} variant="outline">
                        {key}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
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

function OverridePacketStat(props: {
  label: string;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="grid gap-1 rounded-xl border border-border/70 bg-background/80 p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        {props.label}
      </div>
      <div className="text-sm font-semibold text-foreground">{props.value}</div>
      <div className="text-xs leading-5 text-muted">{props.detail}</div>
    </div>
  );
}

function describeStageMetricCard(
  value: unknown,
): { label: string; value: string; detail: string } | null {
  const record = asPacketRecord(value);
  const stageName =
    readPacketString(record.stage_name) ??
    readPacketString(record.name);
  if (!stageName) {
    return null;
  }

  const completedCount = readPacketNumber(record.completed_count);
  const workItemCount = readPacketNumber(record.work_item_count);
  const detailParts: string[] = [];
  const status = readPacketString(record.status);
  const duration = readPacketString(record.duration) ?? readPacketString(record.duration_label);
  if (workItemCount > 0 || completedCount > 0) {
    detailParts.push(`${completedCount}/${workItemCount} items complete`);
  }
  if (status) {
    detailParts.push(status);
  }
  if (duration) {
    detailParts.push(duration);
  }

  return {
    label: stageName,
    value:
      workItemCount > 0 || completedCount > 0
        ? `${completedCount}/${workItemCount}`
        : status ?? 'Captured',
    detail: detailParts.length > 0 ? detailParts.join(' • ') : 'Stage outcome captured in the run summary.',
  };
}

function countStageMetricsWithStatus(stageMetrics: unknown[], status: string): number {
  return stageMetrics.filter((entry) => readPacketString(asPacketRecord(entry).status) === status).length;
}

function countStageMetricsWithGate(stageMetrics: unknown[], statuses: string[]): number {
  return stageMetrics.filter((entry) => {
    const gateStatus = readPacketString(asPacketRecord(entry).gate_status);
    return gateStatus ? statuses.includes(gateStatus) : false;
  }).length;
}

function describeRunOutcomeNarrative(input: {
  completedStages: number;
  gateReviewCount: number;
  producedArtifacts: number;
  reportedSpendUsd: number;
  stageCount: number;
  childBoardCount: number;
}): string {
  const stageSummary =
    input.stageCount > 0
      ? `${input.completedStages} of ${input.stageCount} stages reached completion`
      : 'No stage outcome rows were captured';
  const gateSummary =
    input.gateReviewCount > 0
      ? `${input.gateReviewCount} gate review${input.gateReviewCount === 1 ? '' : 's'} remained active`
      : 'no gate review pressure remained';
  const artifactSummary =
    input.producedArtifacts > 0
      ? `${input.producedArtifacts} artifact${input.producedArtifacts === 1 ? '' : 's'} were recorded`
      : 'no artifacts were recorded';
  const childSummary =
    input.childBoardCount > 0
      ? `${input.childBoardCount} child board${input.childBoardCount === 1 ? '' : 's'} were linked`
      : 'no child boards were linked';
  return `${stageSummary}; ${gateSummary}; reported spend ${formatPacketCurrency(input.reportedSpendUsd)}; ${artifactSummary}; ${childSummary}.`;
}

function asPacketRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asPacketArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readNumericPacketValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readPacketString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readPacketNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatPacketCurrency(value: number): string {
  return `$${value.toFixed(4)}`;
}

function summarizeReasoningProfile(
  reasoningConfig: Record<string, unknown> | null | undefined,
): string {
  if (!hasStructuredEntries(reasoningConfig)) {
    return 'Default';
  }
  return Object.keys(reasoningConfig).join(', ');
}

function readEffectiveModelValue(
  resolution: DashboardEffectiveModelResolution | undefined,
): string {
  if (!resolution?.resolved) {
    return 'Not resolved';
  }
  return `${resolution.resolved.provider.name} / ${resolution.resolved.model.modelId}`;
}

function hasStructuredEntries(
  value: Record<string, unknown> | null | undefined,
): value is Record<string, unknown> {
  return Boolean(value && Object.keys(value).length > 0);
}

function mergeTimelineEntriesWithWorkflowRelations(
  timelineEntries: DashboardWorkspaceTimelineEntry[],
  childRelations: DashboardWorkflowRelationRef[],
): DashboardWorkspaceTimelineEntry[] {
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
