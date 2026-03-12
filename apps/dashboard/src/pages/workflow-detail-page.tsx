import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';

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
  parseMemoryValue,
  readWorkflowProjectId,
  readProjectMemoryEntries,
  readWorkflowRunSummary,
  shouldInvalidateWorkflowRealtimeEvent,
  summarizeTasks,
  type DashboardWorkflowTaskRow,
} from './workflow-detail-support.js';
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
  WorkflowHistoryCard,
  ProjectTimelineCard,
  TaskGraphCard,
  WorkflowActivationsCard,
  WorkflowStagesCard,
} from './workflow-detail-sections.js';
import { WorkflowDocumentsCard, ProjectMemoryCard } from './workflow-detail-content.js';
import { invalidateWorkflowQueries } from './workflow-detail-query.js';
import { buildWorkflowDetailHash } from './workflow-detail-permalinks.js';
import { ChainWorkflowDialog } from '../components/chain-workflow-dialog.js';
import { StructuredRecordView } from '../components/structured-data.js';
import { Button } from '../components/ui/button.js';
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
  const workflowId = params.id ?? '';
  const queryClient = useQueryClient();
  const [memoryKey, setMemoryKey] = useState('last_operator_note');
  const [memoryValue, setMemoryValue] = useState('{\n  "summary": ""\n}');
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
  const historyQuery = useQuery({
    queryKey: ['workflow-history', workflowId],
    queryFn: () =>
      dashboardApi.listEvents({ entity_type: 'workflow', entity_id: workflowId, per_page: '20' }),
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
    boardQuery.data?.work_items,
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

  const summary = useMemo(() => summarizeTasks(taskQuery.data?.data ?? []), [taskQuery.data?.data]);
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
      <section className="grid">
        <div className="card">
          <h2>Board Detail Unavailable</h2>
          <p className="muted">
            This detail view requires a playbook-backed board run.
          </p>
        </div>
      </section>
    );
  }

  async function handleMemorySave() {
    const parsed = parseMemoryValue(memoryValue);
    if (!projectId) {
      setMemoryError('Project memory is only available for project-backed workflows.');
      return;
    }
    if (!memoryKey.trim()) {
      setMemoryError('Memory key must not be empty.');
      return;
    }
    if (parsed.error) {
      setMemoryError(parsed.error);
      return;
    }
    setMemoryError(null);
    setMemoryMessage(null);
    await dashboardApi.patchProjectMemory(projectId, {
      key: memoryKey.trim(),
      value: parsed.value,
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

  return (
    <section className="grid">
      <div className="grid two">
        <div className="card">
          <h2>Board Detail</h2>
          {workflowQuery.isLoading ? <p>Loading board run...</p> : null}
          {workflowQuery.error ? <p style={{ color: '#dc2626' }}>Failed to load board run</p> : null}
          {workflowQuery.data ? (
            <div className="grid">
              <div className="row">
                <strong>{workflowQuery.data.name}</strong>
                <span className={`status-badge status-${workflowQuery.data.state}`}>
                  {workflowQuery.data.state}
                </span>
                {isPlaybookWorkflow && stageDisplay.value ? (
                  <span className="status-badge">{stageDisplay.label}: {stageDisplay.value}</span>
                ) : null}
              </div>
              <StructuredRecordView
                data={workflowQuery.data.context}
                emptyMessage="No workflow context is available yet."
              />
            </div>
          ) : null}
        </div>

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
      </div>

      {isPlaybookWorkflow ? (
        <div className="card">
          <h3>Create Work Item</h3>
          <p className="muted">Add new work directly onto the playbook board.</p>
          <div className="grid" style={{ gap: '0.75rem' }}>
            <label className="grid" style={{ gap: '0.35rem' }}>
              <span>Title</span>
              <Input
                value={workItemTitle}
                onChange={(event) => {
                  setWorkItemError(null);
                  setWorkItemTitle(event.target.value);
                }}
                placeholder="e.g. Implement billing webhooks"
              />
            </label>
            <label className="grid" style={{ gap: '0.35rem' }}>
              <span>Stage</span>
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
            <label className="grid" style={{ gap: '0.35rem' }}>
              <span>Goal</span>
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
            {workItemError ? <p style={{ color: '#dc2626' }}>{workItemError}</p> : null}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Button
                onClick={() => void createWorkItemMutation.mutate()}
                disabled={createWorkItemMutation.isPending}
              >
                {createWorkItemMutation.isPending ? 'Creating…' : 'Create Work Item'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="card">
        <h3>Launch Child Board</h3>
        <p className="muted">Create a linked follow-up board run using a playbook.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => setIsChainDialogOpen(true)}>Create Child Board</Button>
        </div>
      </div>

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

      {selectedWorkItemId ? (
        <div id={buildWorkflowDetailHash({ workItemId: selectedWorkItemId }).slice(1)}>
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
        </div>
      ) : null}

      <div className="grid two">
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

      <div className="grid two">
        <div className="card">
          <h3>Model Overrides</h3>
          <p className="muted">
            Board-run overrides are set at launch time and take precedence over project-level model
            overrides.
          </p>
          {workflowModelOverridesQuery.isLoading ? <p>Loading model overrides...</p> : null}
          {workflowModelOverridesQuery.error ? (
            <p style={{ color: '#dc2626' }}>Failed to load board-run model overrides.</p>
          ) : null}
          {workflowModelOverridesQuery.data ? (
            <StructuredRecordView
              data={workflowModelOverridesQuery.data}
              emptyMessage="No board-run model overrides configured."
            />
          ) : null}
        </div>

        <div className="card">
          <h3>Effective Models</h3>
          <p className="muted">
            Effective resolved models after applying base defaults, project overrides, and any
            workflow launch overrides.
          </p>
          {resolvedModelsQuery.isLoading ? <p>Resolving effective models...</p> : null}
          {resolvedModelsQuery.error ? (
            <p style={{ color: '#dc2626' }}>Failed to load effective models.</p>
          ) : null}
          {resolvedModelsQuery.data ? (
            <ResolvedModelResolutionList effectiveModels={resolvedModelsQuery.data.effective_models} />
          ) : null}
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h3>Resolved Config</h3>
          <p className="muted">
            Merged playbook, project, and board-run configuration for this operator surface.
          </p>
          {configQuery.isLoading ? <p>Loading config...</p> : null}
          {configQuery.error ? (
            <p style={{ color: '#dc2626' }}>Failed to load resolved config.</p>
          ) : null}
          {configQuery.data ? (
            <StructuredRecordView
              data={configQuery.data}
              emptyMessage="No resolved configuration available."
            />
          ) : null}
        </div>

        <div className="card">
          <h3>Board Summary</h3>
          <p className="muted">
            Continuity summary written into project memory when the board run reaches a terminal state.
          </p>
          {runSummary ? (
            <StructuredRecordView
              data={runSummary}
              emptyMessage="Run summary becomes available after the workflow reaches terminal state."
            />
          ) : (
            <p className="muted">
              Run summary becomes available after the workflow reaches terminal state.
            </p>
          )}
        </div>
      </div>

      <div className="grid two">
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
          memoryValue={memoryValue}
          memoryError={memoryError}
          memoryMessage={memoryMessage}
          onMemoryKeyChange={setMemoryKey}
          onMemoryValueChange={setMemoryValue}
          onSave={() => void handleMemorySave()}
        />
      </div>

      <div className="grid two">
        <TaskGraphCard
          tasks={taskQuery.data?.data ?? []}
          stageGroups={stageGroups}
          isLoading={taskQuery.isLoading}
          hasError={Boolean(taskQuery.error)}
        />

        <WorkflowHistoryCard
          isLoading={historyQuery.isLoading}
          hasError={Boolean(historyQuery.error)}
          events={historyQuery.data?.data ?? []}
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
    return <p className="muted">No resolved model information is available.</p>;
  }

  return (
    <div className="grid" style={{ gap: '0.75rem' }}>
      {entries.map(([role, resolution]) => (
        <div key={role} className="rounded-md border bg-border/10 p-3 text-sm">
          <div className="row">
            <strong>{role}</strong>
            <span className="status-badge">{resolution.source}</span>
            {resolution.fallback ? <span className="status-badge status-failed">fallback</span> : null}
          </div>
          {resolution.resolved ? (
            <p className="muted">
              {resolution.resolved.provider.name} / {resolution.resolved.model.modelId}
            </p>
          ) : (
            <p className="muted">No resolved model available.</p>
          )}
          {resolution.fallback_reason ? (
            <p style={{ color: '#dc2626', marginTop: '0.35rem' }}>{resolution.fallback_reason}</p>
          ) : null}
        </div>
      ))}
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
