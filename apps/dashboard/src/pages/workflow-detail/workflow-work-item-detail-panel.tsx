import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import {
  dashboardApi,
  type DashboardWorkflowBoardColumn,
  type DashboardWorkflowStageRecord,
  type DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
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
import { Textarea } from '../../components/ui/textarea.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { cn } from '../../lib/utils.js';
import { normalizeTaskState } from '../../lib/task-state.js';
import type { StructuredEntryDraft } from '../workspace-detail/workspace-detail-support.js';
import { WorkItemEventHistorySection } from './workflow-work-item-history-section.js';
import {
  WorkItemArtifactsSection,
  WorkItemContinuitySection,
  WorkItemHandoffHistorySection,
  WorkItemMemorySection,
} from './workflow-work-item-detail-context-sections.js';
import {
  areWorkItemMetadataDraftsEqual,
  buildWorkItemMetadata,
  createWorkItemMetadataDraftState,
  normalizeWorkItemPriority,
  validateWorkItemMetadataEntries,
  type WorkItemPriority,
} from './workflow-work-item-form-support.js';
import { WorkItemOperatorSection } from './workflow-work-item-operator-section.js';
import {
  buildWorkItemRecoveryBrief,
  buildWorkItemBreadcrumbs,
  describeCountLabel,
  flattenArtifactsByTask,
  findWorkItemById,
  isMilestoneWorkItem,
  summarizeMilestoneOperatorFlow,
  summarizeWorkItemExecution,
  sortMemoryEntriesByKey,
  sortMemoryHistoryNewestFirst,
  sortEventsNewestFirst,
  type DashboardGroupedWorkItemRecord,
  type DashboardWorkItemArtifactRecord,
  type DashboardWorkItemTaskRecord,
} from './workflow-work-item-detail-support.js';
import {
  MilestoneChildrenSection,
  MilestoneOperatorSummarySection,
  WorkItemFocusPacket,
  WorkItemHeader,
  WorkItemReviewClosure,
} from './workflow-work-item-summary-sections.js';
import { WorkItemTasksSection } from './workflow-work-item-tasks-section.js';

interface WorkflowWorkItemDetailPanelProps {
  workflowId: string;
  workItemId: string;
  workItems: DashboardGroupedWorkItemRecord[];
  selectedWorkItem: DashboardGroupedWorkItemRecord | null;
  columns: DashboardWorkflowBoardColumn[];
  stages: DashboardWorkflowStageRecord[];
  ownerRoleOptions: string[];
  tasks: DashboardWorkItemTaskRecord[];
  onSelectWorkItem(workItemId: string): void;
  onWorkItemChanged(): Promise<unknown> | unknown;
  onClearSelection(): void;
}

const metaRowClass = 'flex flex-wrap items-center gap-2';
const mutedBodyClass = 'text-sm leading-6 text-muted';
const loadingTextClass =
  'rounded-lg border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted';
const errorTextClass = 'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700';
const responsiveTabTriggerClass = 'h-auto whitespace-normal px-3 py-2 text-center leading-5';

export function WorkflowWorkItemDetailPanel(props: WorkflowWorkItemDetailPanelProps): JSX.Element {
  const panelTitleId = `work-item-detail-title-${props.workItemId}`;
  const workItemQuery = useQuery({
    queryKey: ['workflow-work-item', props.workflowId, props.workItemId],
    queryFn: () => dashboardApi.getWorkflowWorkItem(props.workflowId, props.workItemId),
    enabled: props.workflowId.length > 0 && props.workItemId.length > 0,
  });
  const eventQuery = useQuery({
    queryKey: ['workflow-work-item-history', props.workflowId, props.workItemId],
    queryFn: () => dashboardApi.listWorkflowWorkItemEvents(props.workflowId, props.workItemId, 50),
    enabled: props.workItemId.length > 0,
  });
  const handoffQuery = useQuery({
    queryKey: ['workflow-work-item-handoffs', props.workflowId, props.workItemId],
    queryFn: () => dashboardApi.listWorkflowWorkItemHandoffs(props.workflowId, props.workItemId),
    enabled: props.workflowId.length > 0 && props.workItemId.length > 0,
  });
  const latestHandoffQuery = useQuery({
    queryKey: ['workflow-work-item-handoffs', props.workflowId, props.workItemId, 'latest'],
    queryFn: () =>
      dashboardApi.getLatestWorkflowWorkItemHandoff(props.workflowId, props.workItemId),
    enabled: props.workflowId.length > 0 && props.workItemId.length > 0,
  });
  const artifactQuery = useQuery({
    queryKey: [
      'workflow-work-item-artifacts',
      props.workflowId,
      props.workItemId,
      props.tasks.map((task) => task.id),
    ],
    queryFn: async (): Promise<DashboardWorkItemArtifactRecord[]> => {
      const artifactSets = await Promise.all(
        props.tasks.map((task) => dashboardApi.listTaskArtifacts(task.id)),
      );
      return flattenArtifactsByTask(props.tasks, artifactSets);
    },
    enabled: props.tasks.length > 0,
  });
  const memoryQuery = useQuery({
    queryKey: ['workflow-work-item-memory', props.workflowId, props.workItemId],
    queryFn: () => dashboardApi.getWorkflowWorkItemMemory(props.workflowId, props.workItemId),
    enabled: props.workflowId.length > 0 && props.workItemId.length > 0,
  });
  const memoryHistoryQuery = useQuery({
    queryKey: ['workflow-work-item-memory-history', props.workflowId, props.workItemId],
    queryFn: () =>
      dashboardApi.getWorkflowWorkItemMemoryHistory(props.workflowId, props.workItemId),
    enabled: props.workflowId.length > 0 && props.workItemId.length > 0,
  });

  const workItem = workItemQuery.data;
  const latestHandoff = latestHandoffQuery.data;
  const events = useMemo(() => sortEventsNewestFirst(eventQuery.data ?? []), [eventQuery.data]);
  const memoryEntries = useMemo(
    () => sortMemoryEntriesByKey(memoryQuery.data?.entries ?? []),
    [memoryQuery.data?.entries],
  );
  const memoryHistory = useMemo(
    () => sortMemoryHistoryNewestFirst(memoryHistoryQuery.data?.history ?? []),
    [memoryHistoryQuery.data?.history],
  );
  const boardWorkItem = useMemo(
    () => props.selectedWorkItem ?? findWorkItemById(props.workItems, props.workItemId),
    [props.selectedWorkItem, props.workItemId, props.workItems],
  );
  const milestoneChildren = useMemo(() => {
    if (boardWorkItem?.children && boardWorkItem.children.length > 0) {
      return boardWorkItem.children;
    }
    const detailWorkItem = workItemQuery.data as DashboardWorkflowWorkItemRecord & {
      children?: DashboardGroupedWorkItemRecord[];
    };
    return Array.isArray(detailWorkItem?.children) ? detailWorkItem.children : [];
  }, [boardWorkItem?.children, workItemQuery.data]);
  const parentMilestones = useMemo(
    () =>
      props.workItems.filter(
        (item) =>
          !item.parent_work_item_id && item.id !== props.workItemId && isMilestoneWorkItem(item),
      ),
    [props.workItemId, props.workItems],
  );
  const workItemBreadcrumbs = useMemo(
    () => buildWorkItemBreadcrumbs(props.workItems, props.workItemId),
    [props.workItemId, props.workItems],
  );
  const milestoneOperatorSummary = useMemo(
    () =>
      isMilestoneWorkItem(boardWorkItem)
        ? summarizeMilestoneOperatorFlow(milestoneChildren, props.tasks)
        : null,
    [boardWorkItem, milestoneChildren, props.tasks],
  );
  const executionSummary = useMemo(() => summarizeWorkItemExecution(props.tasks), [props.tasks]);
  const recoveryBrief = useMemo(() => {
    const selectedWorkItem = boardWorkItem ?? workItem;
    if (!selectedWorkItem) {
      return null;
    }
    return buildWorkItemRecoveryBrief({
      workItem: selectedWorkItem,
      executionSummary,
      milestoneSummary: milestoneOperatorSummary,
    });
  }, [boardWorkItem, executionSummary, milestoneOperatorSummary, workItem]);
  const [stageName, setStageName] = useState('');
  const [columnId, setColumnId] = useState('');
  const [ownerRole, setOwnerRole] = useState('');
  const [parentWorkItemId, setParentWorkItemId] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<WorkItemPriority>(normalizeWorkItemPriority(undefined));
  const [metadataDrafts, setMetadataDrafts] = useState<StructuredEntryDraft[]>([]);
  const [lockedMetadataDraftIds, setLockedMetadataDraftIds] = useState<string[]>([]);
  const [childTitle, setChildTitle] = useState('');
  const [childGoal, setChildGoal] = useState('');
  const [childAcceptanceCriteria, setChildAcceptanceCriteria] = useState('');
  const [childNotes, setChildNotes] = useState('');
  const [childPriority, setChildPriority] = useState<WorkItemPriority>(
    normalizeWorkItemPriority(undefined),
  );
  const [childMetadataDrafts, setChildMetadataDrafts] = useState<StructuredEntryDraft[]>([]);
  const [operatorMessage, setOperatorMessage] = useState<string | null>(null);
  const [operatorError, setOperatorError] = useState<string | null>(null);
  const metadataValidation = useMemo(
    () => validateWorkItemMetadataEntries(metadataDrafts),
    [metadataDrafts],
  );
  const childMetadataValidation = useMemo(
    () => validateWorkItemMetadataEntries(childMetadataDrafts),
    [childMetadataDrafts],
  );

  useEffect(() => {
    const source = boardWorkItem ?? workItem;
    const metadataState = createWorkItemMetadataDraftState(workItem?.metadata ?? source?.metadata);
    setStageName(source?.stage_name ?? '');
    setColumnId(source?.column_id ?? '');
    setOwnerRole(source?.owner_role ?? '');
    setParentWorkItemId(source?.parent_work_item_id ?? '');
    setAcceptanceCriteria(workItem?.acceptance_criteria ?? source?.acceptance_criteria ?? '');
    setNotes(workItem?.notes ?? source?.notes ?? '');
    setPriority(normalizeWorkItemPriority(workItem?.priority ?? source?.priority));
    setMetadataDrafts(metadataState.drafts);
    setLockedMetadataDraftIds(metadataState.lockedDraftIds);
    setOperatorMessage(null);
    setOperatorError(null);
    setChildTitle('');
    setChildGoal('');
    setChildAcceptanceCriteria('');
    setChildNotes('');
    setChildPriority(normalizeWorkItemPriority(undefined));
    setChildMetadataDrafts([]);
  }, [boardWorkItem, workItem, props.workItemId]);

  const updateWorkItemMutation = useMutation({
    mutationFn: async () =>
      dashboardApi.updateWorkflowWorkItem(props.workflowId, props.workItemId, {
        stage_name: stageName || undefined,
        column_id: columnId || undefined,
        owner_role: isMilestoneWorkItem(boardWorkItem) ? null : ownerRole.trim() || null,
        acceptance_criteria: acceptanceCriteria.trim(),
        parent_work_item_id:
          isMilestoneWorkItem(boardWorkItem) || parentWorkItemId.length === 0
            ? null
            : parentWorkItemId,
        priority,
        notes: notes.trim() || null,
        metadata: buildWorkItemMetadata(metadataDrafts),
      }),
    onSuccess: async () => {
      setOperatorError(null);
      setOperatorMessage('Saved work item operator changes.');
      await Promise.all([props.onWorkItemChanged(), workItemQuery.refetch()]);
    },
    onError: (error) => {
      setOperatorMessage(null);
      setOperatorError(error instanceof Error ? error.message : 'Failed to update work item.');
    },
  });
  const createChildMutation = useMutation({
    mutationFn: async () => {
      if (!childTitle.trim()) {
        throw new Error('Child work item title is required.');
      }
      return dashboardApi.createWorkflowWorkItem(props.workflowId, {
        parent_work_item_id: props.workItemId,
        title: childTitle.trim(),
        goal: childGoal.trim() || undefined,
        acceptance_criteria: childAcceptanceCriteria.trim() || undefined,
        stage_name: stageName || undefined,
        column_id: columnId || undefined,
        priority: childPriority,
        notes: childNotes.trim() || undefined,
        metadata: buildWorkItemMetadata(childMetadataDrafts),
      });
    },
    onSuccess: async (created) => {
      setOperatorError(null);
      setOperatorMessage('Created child work item.');
      setChildTitle('');
      setChildGoal('');
      setChildAcceptanceCriteria('');
      setChildNotes('');
      setChildPriority(normalizeWorkItemPriority(undefined));
      setChildMetadataDrafts([]);
      await Promise.all([props.onWorkItemChanged(), workItemQuery.refetch()]);
      props.onSelectWorkItem(created.id);
    },
    onError: (error) => {
      setOperatorMessage(null);
      setOperatorError(
        error instanceof Error ? error.message : 'Failed to create child work item.',
      );
    },
  });
  const canEditParent = !isMilestoneWorkItem(boardWorkItem);
  const currentMetadata = workItem?.metadata ?? boardWorkItem?.metadata;
  const hasOperatorChanges =
    (boardWorkItem?.stage_name ?? workItem?.stage_name ?? '') !== stageName ||
    (boardWorkItem?.column_id ?? workItem?.column_id ?? '') !== columnId ||
    (boardWorkItem?.owner_role ?? workItem?.owner_role ?? '') !== ownerRole ||
    (workItem?.acceptance_criteria ?? boardWorkItem?.acceptance_criteria ?? '') !==
      acceptanceCriteria ||
    normalizeWorkItemPriority(workItem?.priority ?? boardWorkItem?.priority) !== priority ||
    (workItem?.notes ?? boardWorkItem?.notes ?? '') !== notes ||
    !areWorkItemMetadataDraftsEqual(metadataDrafts, currentMetadata) ||
    (canEditParent
      ? (boardWorkItem?.parent_work_item_id ?? workItem?.parent_work_item_id ?? '')
      : '') !== (canEditParent ? parentWorkItemId : '');
  const [activeDetailSurface, setActiveDetailSurface] = useState<
    'summary' | 'operate' | 'evidence'
  >('summary');
  const operatorSectionProps = workItem
    ? ({
        isMilestone: isMilestoneWorkItem(boardWorkItem),
        columns: props.columns,
        stages: props.stages,
        ownerRoleOptions: props.ownerRoleOptions,
        parentMilestones,
        stageName,
        columnId,
        ownerRole,
        parentWorkItemId,
        acceptanceCriteria,
        notes,
        priority,
        metadataDrafts,
        lockedMetadataDraftIds,
        metadataValidation,
        childTitle,
        childGoal,
        childAcceptanceCriteria,
        childNotes,
        childPriority,
        childMetadataDrafts,
        childMetadataValidation,
        onStageNameChange: setStageName,
        onColumnIdChange: setColumnId,
        onOwnerRoleChange: setOwnerRole,
        onParentWorkItemIdChange: setParentWorkItemId,
        onAcceptanceCriteriaChange: setAcceptanceCriteria,
        onNotesChange: setNotes,
        onPriorityChange: setPriority,
        onMetadataDraftsChange: setMetadataDrafts,
        onChildTitleChange: setChildTitle,
        onChildGoalChange: setChildGoal,
        onChildAcceptanceCriteriaChange: setChildAcceptanceCriteria,
        onChildNotesChange: setChildNotes,
        onChildPriorityChange: setChildPriority,
        onChildMetadataDraftsChange: setChildMetadataDrafts,
        onSave: () => updateWorkItemMutation.mutate(),
        onCreateChild: () => createChildMutation.mutate(),
        isSaving: updateWorkItemMutation.isPending,
        isCreatingChild: createChildMutation.isPending,
        hasChanges: hasOperatorChanges,
        canSave: metadataValidation.isValid,
        canCreateChild: childTitle.trim().length > 0 && childMetadataValidation.isValid,
        message: operatorMessage,
        error: operatorError,
      } satisfies Parameters<typeof WorkItemOperatorSection>[0])
    : null;

  useEffect(() => {
    setActiveDetailSurface('summary');
  }, [props.workItemId]);

  return (
    <Card
      className="overflow-hidden border-accent/30 bg-surface/95 shadow-lg ring-1 ring-accent/10"
      data-testid="work-item-detail-shell"
      data-selected-panel="true"
      data-workflow-focus-anchor="true"
      tabIndex={-1}
      aria-labelledby={panelTitleId}
    >
      <CardHeader className="gap-3 border-b border-border/70 bg-gradient-to-br from-surface via-surface to-border/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="grid gap-3">
            <div className={metaRowClass}>
              <Badge variant="secondary">Selected work item</Badge>
              <Badge variant="outline">
                {describeCountLabel(props.tasks.length, 'linked step')}
              </Badge>
              {artifactQuery.data ? (
                <Badge variant="outline">
                  {describeCountLabel(artifactQuery.data.length, 'artifact')}
                </Badge>
              ) : null}
            </div>
            <div className="grid gap-2">
              <CardTitle id={panelTitleId} className="text-xl">
                Work Item Detail
              </CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6">
                Start with the summary, open controls only when editing, then switch to evidence
                when you need execution detail.
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" onClick={props.onClearSelection}>
            Clear Selection
          </Button>
        </div>
      </CardHeader>

      <CardContent className="grid gap-5 p-4">
        {workItemQuery.isLoading ? <p className={loadingTextClass}>Loading work item...</p> : null}
        {workItemQuery.error ? (
          <p className={errorTextClass}>Failed to load work item detail.</p>
        ) : null}
        {workItem ? (
          <Tabs
            value={activeDetailSurface}
            onValueChange={(value) =>
              setActiveDetailSurface(value as 'summary' | 'operate' | 'evidence')
            }
            className="grid gap-4"
          >
            <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-xl border border-border/70 bg-border/10 p-1 md:grid-cols-3">
              <TabsTrigger value="summary" className={responsiveTabTriggerClass}>
                Summary
              </TabsTrigger>
              <TabsTrigger value="operate" className={responsiveTabTriggerClass}>
                Controls
              </TabsTrigger>
              <TabsTrigger value="evidence" className={responsiveTabTriggerClass}>
                Evidence
              </TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="mt-0 grid gap-4">
              <WorkItemHeader
                workItem={boardWorkItem ?? workItem}
                breadcrumbs={workItemBreadcrumbs}
                childCount={milestoneChildren.length}
                linkedTaskCount={props.tasks.length}
                artifactCount={artifactQuery.data?.length ?? 0}
                stages={props.stages}
                onSelectWorkItem={props.onSelectWorkItem}
              />
              {recoveryBrief ? (
                <WorkItemRecoveryBriefSection
                  brief={recoveryBrief}
                  workflowId={props.workflowId}
                  workItemId={props.workItemId}
                  tasks={props.tasks}
                  onWorkItemChanged={props.onWorkItemChanged}
                />
              ) : null}
              <WorkItemFocusPacket
                executionSummary={executionSummary}
                artifactCount={artifactQuery.data?.length ?? 0}
                memoryCount={memoryEntries.length}
                eventCount={events.length}
              />
              <WorkItemContinuitySection
                workItem={workItem}
                handoffCount={handoffQuery.data?.length ?? 0}
                latestHandoff={latestHandoff ?? null}
                isLoading={handoffQuery.isLoading || latestHandoffQuery.isLoading}
              />
              <WorkItemHandoffHistorySection
                handoffs={handoffQuery.data ?? []}
                isLoading={handoffQuery.isLoading}
              />
              {milestoneOperatorSummary ? (
                <MilestoneOperatorSummarySection summary={milestoneOperatorSummary} />
              ) : null}
              {isMilestoneWorkItem(boardWorkItem) ? (
                <MilestoneChildrenSection
                  children={milestoneChildren}
                  onSelectWorkItem={props.onSelectWorkItem}
                />
              ) : null}
              <WorkItemReviewClosure
                title="Summary complete"
                detail="Open operator controls to reroute or edit this work item, or switch to evidence when you need step-by-step execution detail."
              />
            </TabsContent>

            <TabsContent value="operate" className="mt-0 grid gap-4">
              {operatorSectionProps ? <WorkItemOperatorSection {...operatorSectionProps} /> : null}
              <WorkItemReviewClosure
                title="Operator changes are contained here"
                detail="This editing surface is separated from the execution evidence so board review stays lightweight until you intentionally switch into edit mode."
              />
            </TabsContent>

            <TabsContent value="evidence" className="mt-0 grid gap-4">
              <Tabs defaultValue="steps" className="grid gap-4" data-testid="work-item-detail-tabs">
                <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-xl border border-border/70 bg-border/10 p-1 xl:grid-cols-4">
                  <TabsTrigger value="steps" className={responsiveTabTriggerClass}>
                    Steps
                  </TabsTrigger>
                  <TabsTrigger value="memory" className={responsiveTabTriggerClass}>
                    Memory
                  </TabsTrigger>
                  <TabsTrigger value="artifacts" className={responsiveTabTriggerClass}>
                    Artifacts
                  </TabsTrigger>
                  <TabsTrigger value="history" className={responsiveTabTriggerClass}>
                    History
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="steps" className="mt-0 grid">
                  <WorkItemTasksSection
                    workflowId={props.workflowId}
                    workItemId={props.workItemId}
                    tasks={props.tasks}
                    executionSummary={executionSummary}
                    isMilestone={isMilestoneWorkItem(boardWorkItem)}
                    childCount={milestoneChildren.length}
                    onWorkItemChanged={props.onWorkItemChanged}
                  />
                </TabsContent>

                <TabsContent value="memory" className="mt-0 grid">
                  <WorkItemMemorySection
                    isLoading={memoryQuery.isLoading}
                    hasError={Boolean(memoryQuery.error)}
                    entries={memoryEntries}
                    history={memoryHistory}
                    isHistoryLoading={memoryHistoryQuery.isLoading}
                    hasHistoryError={Boolean(memoryHistoryQuery.error)}
                  />
                </TabsContent>

                <TabsContent value="artifacts" className="mt-0 grid">
                  <WorkItemArtifactsSection
                    isLoading={artifactQuery.isLoading}
                    hasError={Boolean(artifactQuery.error)}
                    tasks={props.tasks}
                    artifacts={artifactQuery.data ?? []}
                  />
                </TabsContent>

                <TabsContent value="history" className="mt-0 grid">
                  <WorkItemEventHistorySection
                    workflowId={props.workflowId}
                    workItemId={props.workItemId}
                    isLoading={eventQuery.isLoading}
                    hasError={Boolean(eventQuery.error)}
                    events={events}
                  />
                </TabsContent>
              </Tabs>
              <WorkItemReviewClosure
                title="Evidence packet complete"
                detail="When you have enough signal, return to operator controls to save changes or clear the selection to go back to broad board triage."
              />
            </TabsContent>
          </Tabs>
        ) : null}
      </CardContent>
    </Card>
  );
}

function WorkItemRecoveryBriefSection(props: {
  brief: ReturnType<typeof buildWorkItemRecoveryBrief>;
  workflowId: string;
  workItemId: string;
  tasks: DashboardWorkItemTaskRecord[];
  onWorkItemChanged(): Promise<unknown> | unknown;
}): JSX.Element {
  const recoveryTask = useMemo(() => selectWorkItemRecoveryTask(props.tasks), [props.tasks]);
  const shouldForceRetry = recoveryTask
    ? normalizeTaskState(recoveryTask.state) !== 'failed'
    : false;
  const [isSkipDialogOpen, setIsSkipDialogOpen] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setIsSkipDialogOpen(false);
    setSkipReason('');
    setActionError(null);
  }, [props.workItemId]);

  const retryMutation = useMutation({
    mutationFn: () =>
      dashboardApi.retryWorkflowWorkItem(props.workflowId, props.workItemId, {
        force: shouldForceRetry,
      }),
    onSuccess: async () => {
      setActionError(null);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setActionError(
        mutationError instanceof Error ? mutationError.message : 'Failed to retry work item.',
      );
    },
  });
  const skipMutation = useMutation({
    mutationFn: () =>
      dashboardApi.skipWorkflowWorkItem(props.workflowId, props.workItemId, {
        reason: skipReason.trim(),
      }),
    onSuccess: async () => {
      setActionError(null);
      setSkipReason('');
      setIsSkipDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setActionError(
        mutationError instanceof Error ? mutationError.message : 'Failed to skip work item.',
      );
    },
  });
  const canAct = recoveryTask !== null;
  const retryLabel = shouldForceRetry ? 'Force Retry Work Item' : 'Retry Work Item';

  return (
    <section
      className={cn(
        'grid gap-4 rounded-xl border p-4 shadow-sm',
        props.brief.tone === 'destructive'
          ? 'border-red-300/70 bg-red-50/80 dark:border-red-900/70 dark:bg-red-950/20'
          : props.brief.tone === 'warning'
            ? 'border-amber-300/70 bg-amber-50/80 dark:border-amber-900/70 dark:bg-amber-950/20'
            : props.brief.tone === 'success'
              ? 'border-green-300/70 bg-green-50/80 dark:border-green-900/70 dark:bg-green-950/20'
              : 'border-border/70 bg-border/10',
      )}
      data-testid="work-item-recovery-brief"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Recovery brief
          </div>
          <strong className="text-base text-foreground">{props.brief.title}</strong>
          <p className={mutedBodyClass}>{props.brief.summary}</p>
        </div>
        <Badge variant={props.brief.tone}>{props.brief.badge}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {props.brief.facts.map((fact) => (
          <Badge key={fact.label} variant="outline">
            {fact.label}: {fact.value}
          </Badge>
        ))}
      </div>
      <div className="grid gap-3 rounded-lg border border-border/70 bg-background/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-sm text-foreground">Work-item recovery</strong>
          <Badge variant={canAct ? 'warning' : 'outline'}>
            {canAct ? 'Board-owned step recovery' : 'No retryable step selected'}
          </Badge>
        </div>
        <p className={mutedBodyClass}>
          {recoveryTask
            ? `Actions apply to ${recoveryTask.title} so the board keeps recovery decisions attached to the work item instead of bouncing through the task detail surface.`
            : 'No failed or escalated step is currently available for recovery from this work item.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => retryMutation.mutate()}
            disabled={!canAct || retryMutation.isPending || skipMutation.isPending}
          >
            {retryLabel}
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsSkipDialogOpen(true)}
            disabled={!canAct || retryMutation.isPending || skipMutation.isPending}
          >
            Skip Work Item
          </Button>
        </div>
      </div>
      {actionError ? <p className={errorTextClass}>{actionError}</p> : null}
      <Dialog open={isSkipDialogOpen} onOpenChange={setIsSkipDialogOpen}>
        <DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Skip Work Item</DialogTitle>
            <DialogDescription>
              Keep the bypass reason attached to the work item so recovery stays board-owned and
              does not drift back to the raw task helper.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Textarea
              value={skipReason}
              onChange={(event) => setSkipReason(event.target.value)}
              placeholder="Describe why this work item recovery step should be skipped..."
              rows={4}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setIsSkipDialogOpen(false)}
                disabled={skipMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => skipMutation.mutate()}
                disabled={!skipReason.trim() || skipMutation.isPending}
              >
                Skip Work Item
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function selectWorkItemRecoveryTask(
  tasks: DashboardWorkItemTaskRecord[],
): DashboardWorkItemTaskRecord | null {
  const ordered = sortTasksForOperatorReview(tasks);
  return (
    ordered.find((task) => normalizeTaskState(task.state) === 'failed') ??
    ordered.find((task) => normalizeTaskState(task.state) === 'escalated') ??
    null
  );
}
