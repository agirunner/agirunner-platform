import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import {
  dashboardApi,
  type DashboardAgentRecord,
  type DashboardTaskHandoffRecord,
  type DashboardWorkItemMemoryEntry,
  type DashboardWorkItemMemoryHistoryEntry,
  type DashboardWorkflowBoardColumn,
  type DashboardWorkflowStageRecord,
  type DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import { buildArtifactPermalink } from '../../components/artifact-preview/artifact-preview-support.js';
import {
  CopyableIdBadge,
  OperatorStatusBadge,
  RelativeTimestamp,
} from '../../components/operator-display/operator-display.js';
import { StructuredRecordView } from '../../components/structured-data/structured-data.js';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { cn } from '../../lib/utils.js';
import { normalizeTaskState } from '../../lib/task-state.js';
import type { StructuredEntryDraft } from '../workspace-detail/workspace-detail-support.js';
import { WorkItemEventHistorySection } from './workflow-work-item-history-section.js';
import {
  areWorkItemMetadataDraftsEqual,
  buildWorkItemMetadata,
  createWorkItemMetadataDraftState,
  normalizeWorkItemPriority,
  validateWorkItemMetadataEntries,
  WORK_ITEM_PRIORITY_OPTIONS,
  type WorkItemPriority,
} from './workflow-work-item-form-support.js';
import { WorkItemMetadataEditor } from './workflow-work-item-metadata-editor.js';
import { buildWorkItemTaskLinkActions } from './workflow-work-item-task-actions.js';
import {
  StepChangesDialog,
  StepEscalationDialog,
  StepOutputOverrideDialog,
  WorkItemReassignDialog,
  formatOutputOverrideDraft,
  parseOutputOverrideDraft,
} from './workflow-work-item-task-review-dialogs.js';
import {
  buildWorkItemRecoveryBrief,
  buildWorkItemBreadcrumbs,
  describeCountLabel,
  describeTaskOperatorPosture,
  describeWorkItemArtifactIdentity,
  flattenArtifactsByTask,
  findWorkItemById,
  isMilestoneWorkItem,
  sortTasksForOperatorReview,
  summarizeMilestoneOperatorFlow,
  summarizeWorkItemExecution,
  summarizeStructuredValue,
  sortMemoryEntriesByKey,
  sortMemoryHistoryNewestFirst,
  sortEventsNewestFirst,
  type DashboardGroupedWorkItemRecord,
  type DashboardWorkItemArtifactRecord,
  type DashboardWorkItemTaskRecord,
} from './workflow-work-item-detail-support.js';

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

const sectionFrameClass = 'rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm';
const metaRowClass = 'flex flex-wrap items-center gap-2';
const mutedBodyClass = 'text-sm leading-6 text-muted';
const fieldStackClass = 'grid gap-2';
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

function WorkItemOperatorSection(props: {
  isMilestone: boolean;
  columns: DashboardWorkflowBoardColumn[];
  stages: DashboardWorkflowStageRecord[];
  ownerRoleOptions: string[];
  parentMilestones: DashboardGroupedWorkItemRecord[];
  stageName: string;
  columnId: string;
  ownerRole: string;
  parentWorkItemId: string;
  acceptanceCriteria: string;
  notes: string;
  priority: WorkItemPriority;
  metadataDrafts: StructuredEntryDraft[];
  lockedMetadataDraftIds: string[];
  metadataValidation: ReturnType<typeof validateWorkItemMetadataEntries>;
  childTitle: string;
  childGoal: string;
  childAcceptanceCriteria: string;
  childNotes: string;
  childPriority: WorkItemPriority;
  childMetadataDrafts: StructuredEntryDraft[];
  childMetadataValidation: ReturnType<typeof validateWorkItemMetadataEntries>;
  onStageNameChange(value: string): void;
  onColumnIdChange(value: string): void;
  onOwnerRoleChange(value: string): void;
  onParentWorkItemIdChange(value: string): void;
  onAcceptanceCriteriaChange(value: string): void;
  onNotesChange(value: string): void;
  onPriorityChange(value: WorkItemPriority): void;
  onMetadataDraftsChange(value: StructuredEntryDraft[]): void;
  onChildTitleChange(value: string): void;
  onChildGoalChange(value: string): void;
  onChildAcceptanceCriteriaChange(value: string): void;
  onChildNotesChange(value: string): void;
  onChildPriorityChange(value: WorkItemPriority): void;
  onChildMetadataDraftsChange(value: StructuredEntryDraft[]): void;
  onSave(): void;
  onCreateChild(): void;
  isSaving: boolean;
  isCreatingChild: boolean;
  hasChanges: boolean;
  canSave: boolean;
  canCreateChild: boolean;
  message: string | null;
  error: string | null;
}): JSX.Element {
  const selectedPriority = WORK_ITEM_PRIORITY_OPTIONS.find(
    (option) => option.value === props.priority,
  );
  const selectedChildPriority = WORK_ITEM_PRIORITY_OPTIONS.find(
    (option) => option.value === props.childPriority,
  );
  const [activeControlSurface, setActiveControlSurface] = useState<
    'brief' | 'routing' | 'decompose'
  >(props.isMilestone ? 'brief' : 'routing');

  useEffect(() => {
    setActiveControlSurface(props.isMilestone ? 'brief' : 'routing');
  }, [props.isMilestone]);

  return (
    <section
      className="grid gap-4 rounded-xl border border-border/70 bg-gradient-to-br from-border/10 via-surface to-surface p-4 shadow-sm"
      data-testid="work-item-operator-controls"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid gap-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Operator flow controls
          </div>
          <strong className="text-base">Operator Flow Controls</strong>
        </div>
        {props.isMilestone ? (
          <Badge variant="outline">Milestone operator mode</Badge>
        ) : (
          <Badge variant="outline">Child/top-level operator mode</Badge>
        )}
      </div>
      <p className={mutedBodyClass}>
        Adjust board placement, stage ownership, and milestone nesting without leaving the work-item
        operator view.
      </p>
      <Tabs
        value={activeControlSurface}
        onValueChange={(value) =>
          setActiveControlSurface(value as 'brief' | 'routing' | 'decompose')
        }
        className="grid gap-4"
      >
        <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-xl border border-border/70 bg-background/80 p-1 md:grid-cols-3">
          <TabsTrigger value="brief" className={responsiveTabTriggerClass}>
            Brief &amp; metadata
          </TabsTrigger>
          <TabsTrigger value="routing" className={responsiveTabTriggerClass}>
            Routing &amp; ownership
          </TabsTrigger>
          <TabsTrigger
            value="decompose"
            className={responsiveTabTriggerClass}
            disabled={!props.isMilestone}
          >
            Milestone plan
          </TabsTrigger>
        </TabsList>

        <TabsContent value="brief" className="mt-0 grid gap-4">
          <OperatorSectionCard
            eyebrow="Work-item brief"
            title="Brief and operator notes"
            description="Keep the selected work-item packet current with explicit priority, acceptance criteria, and operator notes."
          >
            <div className="grid gap-4">
              <label className={fieldStackClass}>
                <span className="text-sm font-medium text-foreground">Priority</span>
                <Select
                  value={props.priority}
                  onValueChange={(value) =>
                    props.onPriorityChange(normalizeWorkItemPriority(value))
                  }
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
                <p className="text-xs leading-5 text-muted">{selectedPriority?.description}</p>
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className={fieldStackClass}>
                  <span className="text-sm font-medium text-foreground">Acceptance criteria</span>
                  <Textarea
                    value={props.acceptanceCriteria}
                    onChange={(event) => props.onAcceptanceCriteriaChange(event.target.value)}
                    className="min-h-[124px]"
                    placeholder="List the conditions that define done for this work item."
                  />
                </label>
                <label className={fieldStackClass}>
                  <span className="text-sm font-medium text-foreground">Notes</span>
                  <Textarea
                    value={props.notes}
                    onChange={(event) => props.onNotesChange(event.target.value)}
                    className="min-h-[124px]"
                    placeholder="Capture operator context, watchouts, or board-specific follow-up."
                  />
                </label>
              </div>
            </div>
          </OperatorSectionCard>
          <OperatorSectionCard
            eyebrow="Structured metadata"
            title="Metadata patch"
            description="Update typed metadata entries with structured controls. Existing keys can be edited here, but key removal is not supported in this operator flow."
          >
            <WorkItemMetadataEditor
              title="Work-item metadata"
              description="Use typed key and value rows instead of raw JSON so metadata stays accessible in the operator surface."
              drafts={props.metadataDrafts}
              validation={props.metadataValidation}
              addLabel="Add Metadata Entry"
              lockedDraftIds={props.lockedMetadataDraftIds}
              onChange={props.onMetadataDraftsChange}
            />
          </OperatorSectionCard>
        </TabsContent>

        <TabsContent value="routing" className="mt-0 grid gap-4">
          <OperatorSectionCard
            eyebrow="Board placement"
            title="Stage and board routing"
            description="Keep the work item in the correct stage and visible board column while execution is in flight."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className={fieldStackClass}>
                <span className="text-sm font-medium text-foreground">Stage</span>
                <Select value={props.stageName} onValueChange={props.onStageNameChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {props.stages.map((stage) => (
                      <SelectItem key={stage.id} value={stage.name}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className={fieldStackClass}>
                <span className="text-sm font-medium text-foreground">Board column</span>
                <Select value={props.columnId} onValueChange={props.onColumnIdChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select column" />
                  </SelectTrigger>
                  <SelectContent>
                    {props.columns.map((column) => (
                      <SelectItem key={column.id} value={column.id}>
                        {column.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          </OperatorSectionCard>

          <OperatorSectionCard
            eyebrow="Ownership and linkage"
            title={props.isMilestone ? 'Milestone ownership' : 'Ownership and milestone linkage'}
            description={
              props.isMilestone
                ? 'Milestones stay top-level and coordinate child delivery rather than nesting under another parent.'
                : 'Adjust responsibility and milestone grouping without leaving the selected work-item flow.'
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              {!props.isMilestone ? (
                <label className={fieldStackClass}>
                  <span className="text-sm font-medium text-foreground">
                    Reparent under milestone
                  </span>
                  <Select
                    value={props.parentWorkItemId || '__none__'}
                    onValueChange={(value) =>
                      props.onParentWorkItemIdChange(value === '__none__' ? '' : value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Top-level work item" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Top-level work item</SelectItem>
                      {props.parentMilestones.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              ) : (
                <div className="rounded-lg border border-border/70 bg-border/10 p-4 text-sm leading-6 text-muted">
                  Parent milestones stay top-level. Move or reparent child work items instead of
                  nesting milestones.
                </div>
              )}
              <label className={fieldStackClass}>
                <span className="text-sm font-medium text-foreground">
                  {props.isMilestone ? 'Owner role' : 'Owner role override'}
                </span>
                <Select
                  value={props.ownerRole || '__unassigned__'}
                  onValueChange={(value) =>
                    props.onOwnerRoleChange(value === '__unassigned__' ? '' : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select owner role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {props.ownerRoleOptions.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs leading-5 text-muted">
                  {props.ownerRoleOptions.length > 0
                    ? 'Choose from roles already active on this board run instead of typing a free-form override.'
                    : 'No known board roles are available yet. Configure roles on the playbook or through active model assignments first.'}
                </p>
              </label>
            </div>
          </OperatorSectionCard>
        </TabsContent>

        {props.isMilestone ? (
          <TabsContent value="decompose" className="mt-0 grid gap-4">
            <OperatorSectionCard
              eyebrow="Milestone decomposition"
              title="Create child work item"
              description="Break this milestone into child deliverables so operators can track each downstream work item separately."
            >
              <div className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className={fieldStackClass}>
                    <span className="text-sm font-medium text-foreground">Title</span>
                    <Input
                      value={props.childTitle}
                      onChange={(event) => props.onChildTitleChange(event.target.value)}
                      placeholder="e.g. Implement auth service"
                    />
                  </label>
                  <label className={fieldStackClass}>
                    <span className="text-sm font-medium text-foreground">Priority</span>
                    <Select
                      value={props.childPriority}
                      onValueChange={(value) =>
                        props.onChildPriorityChange(normalizeWorkItemPriority(value))
                      }
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
                    <p className="text-xs leading-5 text-muted">
                      {selectedChildPriority?.description}
                    </p>
                  </label>
                </div>
                <label className={fieldStackClass}>
                  <span className="text-sm font-medium text-foreground">Goal</span>
                  <Textarea
                    value={props.childGoal}
                    onChange={(event) => props.onChildGoalChange(event.target.value)}
                    className="min-h-[96px]"
                    placeholder="Describe the child deliverable."
                  />
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className={fieldStackClass}>
                    <span className="text-sm font-medium text-foreground">
                      Child acceptance criteria
                    </span>
                    <Textarea
                      value={props.childAcceptanceCriteria}
                      onChange={(event) =>
                        props.onChildAcceptanceCriteriaChange(event.target.value)
                      }
                      className="min-h-[124px]"
                      placeholder="List the acceptance criteria this child work item must satisfy."
                    />
                  </label>
                  <label className={fieldStackClass}>
                    <span className="text-sm font-medium text-foreground">Child notes</span>
                    <Textarea
                      value={props.childNotes}
                      onChange={(event) => props.onChildNotesChange(event.target.value)}
                      className="min-h-[124px]"
                      placeholder="Capture operator guidance or notes for the child item."
                    />
                  </label>
                </div>
                <WorkItemMetadataEditor
                  title="Child metadata"
                  description="Attach supported typed metadata to the child work item without writing raw JSON."
                  drafts={props.childMetadataDrafts}
                  validation={props.childMetadataValidation}
                  addLabel="Add Child Metadata Entry"
                  onChange={props.onChildMetadataDraftsChange}
                />
                <div className="flex justify-end">
                  <Button
                    onClick={props.onCreateChild}
                    disabled={!props.canCreateChild || props.isCreatingChild}
                  >
                    {props.isCreatingChild ? 'Creating…' : 'Create Child Work Item'}
                  </Button>
                </div>
              </div>
            </OperatorSectionCard>
          </TabsContent>
        ) : null}
      </Tabs>
      {props.error ? <p className={errorTextClass}>{props.error}</p> : null}
      {props.message ? (
        <p className="rounded-lg border border-border/70 bg-surface px-4 py-3 text-sm text-muted">
          {props.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-surface/70 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant={props.hasChanges ? 'warning' : 'outline'}>
            {props.hasChanges ? 'Unsaved operator changes' : 'No pending control changes'}
          </Badge>
          {props.isMilestone ? (
            <Badge variant="secondary">Milestone flow</Badge>
          ) : (
            <Badge variant="secondary">Work-item flow</Badge>
          )}
        </div>
        <Button
          onClick={props.onSave}
          disabled={!props.hasChanges || props.isSaving || !props.canSave}
        >
          {props.isSaving ? 'Saving…' : 'Save Operator Changes'}
        </Button>
      </div>
    </section>
  );
}

function OperatorSectionCard(props: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={cn(sectionFrameClass, 'grid gap-4')}>
      <div className="grid gap-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          {props.eyebrow}
        </div>
        <strong className="text-base">{props.title}</strong>
        <p className={mutedBodyClass}>{props.description}</p>
      </div>
      {props.children}
    </div>
  );
}

function WorkItemMemorySection(props: {
  isLoading: boolean;
  hasError: boolean;
  entries: DashboardWorkItemMemoryEntry[];
  history: DashboardWorkItemMemoryHistoryEntry[];
  isHistoryLoading: boolean;
  hasHistoryError: boolean;
}): JSX.Element {
  if (props.isLoading) {
    return <p className={loadingTextClass}>Loading work-item memory...</p>;
  }
  if (props.hasError) {
    return <p className={errorTextClass}>Failed to load work-item memory.</p>;
  }

  return (
    <div className="grid gap-4">
      <section className="grid gap-3 rounded-xl border border-border/70 bg-surface p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-base">Current memory</strong>
          <Badge variant="outline">{describeCountLabel(props.entries.length, 'entry')}</Badge>
        </div>
        {props.entries.length === 0 ? (
          <MemoryEmptyState
            title="No scoped memory yet"
            badge="Waiting for first write"
            summary="This work item has not stored any scoped memory packets yet."
            detail="Current memory shows the latest saved value for each key after the orchestrator or linked steps write scoped context."
          />
        ) : (
          props.entries.map((entry) => (
            <article
              key={`${entry.key}:${entry.event_id}`}
              className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <strong>{entry.key}</strong>
                <Badge variant="outline">{entry.stage_name ?? 'work item scope'}</Badge>
              </div>
              <div className={metaRowClass}>
                <Badge variant="outline">{entry.actor_type}</Badge>
                {entry.task_id ? <CopyableIdBadge value={entry.task_id} label="Step" /> : null}
                <RelativeTimestamp value={entry.updated_at} prefix="Updated" />
              </div>
              <StructuredValueReview
                label="Memory packet"
                value={entry.value}
                emptyMessage="No memory payload."
                disclosureLabel="Open full memory packet"
              />
            </article>
          ))
        )}
      </section>

      <section className="grid gap-3 rounded-xl border border-border/70 bg-surface p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-base">Memory history</strong>
          <Badge variant="outline">{describeCountLabel(props.history.length, 'event')}</Badge>
        </div>
        {props.isHistoryLoading ? (
          <p className={loadingTextClass}>Loading memory history...</p>
        ) : null}
        {props.hasHistoryError ? (
          <p className={errorTextClass}>Failed to load work-item memory history.</p>
        ) : null}
        {!props.isHistoryLoading && !props.hasHistoryError && props.history.length === 0 ? (
          <MemoryEmptyState
            title="No memory changes yet"
            badge="No history events"
            summary="There are no recorded create, update, or delete events for work-item memory yet."
            detail="History preserves each write in order so operators can reconstruct how the memory packet changed over time."
          />
        ) : null}
        {!props.isHistoryLoading && !props.hasHistoryError
          ? props.history.map((entry) => (
              <article
                key={`history:${entry.event_id}`}
                className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <strong>{entry.key}</strong>
                  <Badge variant={entry.event_type === 'deleted' ? 'secondary' : 'outline'}>
                    {formatMemoryHistoryEventType(entry.event_type)}
                  </Badge>
                </div>
                <div className={metaRowClass}>
                  <Badge variant="outline">{entry.actor_type}</Badge>
                  {entry.stage_name ? <Badge variant="outline">{entry.stage_name}</Badge> : null}
                  {entry.task_id ? <CopyableIdBadge value={entry.task_id} label="Step" /> : null}
                  <RelativeTimestamp value={entry.updated_at} prefix="Updated" />
                </div>
                <StructuredValueReview
                  label="Memory change packet"
                  value={entry.value}
                  emptyMessage="No memory payload."
                  disclosureLabel="Open full change packet"
                />
              </article>
            ))
          : null}
      </section>
    </div>
  );
}

function WorkItemHeader(props: {
  workItem: DashboardGroupedWorkItemRecord;
  breadcrumbs: string[];
  childCount: number;
  linkedTaskCount: number;
  artifactCount: number;
  stages: DashboardWorkflowStageRecord[];
  onSelectWorkItem(workItemId: string): void;
}): JSX.Element {
  const { workItem } = props;
  const milestone = isMilestoneWorkItem(workItem);
  const completedChildren =
    workItem.children_completed ??
    workItem.children?.filter((child) => child.completed_at).length ??
    0;
  const stageRecord = props.stages.find((stage) => stage.name === workItem.stage_name) ?? null;
  return (
    <section className="grid gap-4 rounded-xl border border-border/70 bg-gradient-to-br from-border/10 via-surface to-surface p-4 shadow-sm">
      <div className={metaRowClass}>
        <Badge variant="outline">Operator breadcrumb</Badge>
        <CopyableIdBadge value={workItem.id} label="Work item" />
        <span className="text-sm text-muted">
          {(props.breadcrumbs.length > 0 ? props.breadcrumbs : [workItem.title]).join(' / ')}
          {workItem.stage_name ? ` / ${workItem.stage_name}` : ''}
        </span>
      </div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="grid gap-2">
          <strong className="text-xl leading-tight">{workItem.title}</strong>
          {workItem.goal ? <p className={mutedBodyClass}>{workItem.goal}</p> : null}
        </div>
        <div className={cn(metaRowClass, 'xl:max-w-[45%] xl:justify-end')}>
          <Badge variant="outline">{workItem.stage_name ?? 'Unassigned stage'}</Badge>
          <Badge variant="outline">{workItem.priority ?? 'normal'}</Badge>
          <Badge variant="outline">{workItem.column_id ?? 'Unassigned column'}</Badge>
          {stageRecord && stageRecord.iteration_count > 0 ? (
            <Badge variant="warning">
              {stageRecord.iteration_count} stage iteration
              {stageRecord.iteration_count === 1 ? '' : 's'}
            </Badge>
          ) : null}
          {milestone ? <Badge variant="outline">Milestone</Badge> : null}
          {milestone ? (
            <Badge variant="outline">
              {completedChildren}/{props.childCount} children complete
            </Badge>
          ) : null}
          <OperatorStatusBadge status={workItem.completed_at ? 'completed' : 'active'} />
        </div>
      </div>
      <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          Current routing
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{workItem.stage_name ?? 'Unassigned stage'}</Badge>
          <Badge variant="outline">{workItem.column_id ?? 'Unassigned column'}</Badge>
          <Badge variant="outline">
            {describeCountLabel(props.linkedTaskCount, 'linked step')}
          </Badge>
          <Badge variant="outline">{describeCountLabel(props.artifactCount, 'artifact')}</Badge>
          {workItem.owner_role ? <Badge variant="outline">{workItem.owner_role}</Badge> : null}
          {typeof workItem.rework_count === 'number' && workItem.rework_count > 0 ? (
            <Badge variant="warning">
              {workItem.rework_count} rework loop{workItem.rework_count === 1 ? '' : 's'}
            </Badge>
          ) : null}
        </div>
        <p className={mutedBodyClass}>
          {milestone
            ? `This milestone coordinates ${props.childCount} child work item${props.childCount === 1 ? '' : 's'} across the board.`
            : 'Review the summary first. Open controls only when routing or metadata needs to change.'}
        </p>
        {readContinuitySummary(workItem) ? (
          <div className="rounded-lg border border-border/70 bg-muted/10 px-3 py-2 text-sm text-muted">
            <span className="font-medium text-foreground">Operator next step:</span>{' '}
            {readContinuitySummary(workItem)}
          </div>
        ) : null}
      </div>
      {stageRecord ? <WorkItemStageProgressCard stage={stageRecord} /> : null}
      <div className={metaRowClass}>
        {workItem.task_count !== undefined ? (
          <Badge variant="outline">{describeCountLabel(workItem.task_count, 'linked step')}</Badge>
        ) : null}
        {workItem.parent_work_item_id ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => props.onSelectWorkItem(workItem.parent_work_item_id as string)}
          >
            Open parent milestone
          </Button>
        ) : null}
      </div>
      {workItem.acceptance_criteria ? (
        <div className="rounded-xl border border-border/70 bg-border/10 p-4 text-sm">
          <strong>Acceptance criteria</strong>
          <p className="mt-2 text-sm leading-6 text-muted">{workItem.acceptance_criteria}</p>
        </div>
      ) : null}
      {workItem.notes ? (
        <div className="rounded-xl border border-border/70 bg-border/10 p-4 text-sm">
          <strong>Notes</strong>
          <p className="mt-2 text-sm leading-6 text-muted">{workItem.notes}</p>
        </div>
      ) : null}
    </section>
  );
}

function readContinuitySummary(workItem: DashboardGroupedWorkItemRecord): string | null {
  if (workItem.blocked_state === 'blocked') {
    return workItem.blocked_reason?.trim()
      ? `Blocked: ${workItem.blocked_reason.trim()}`
      : 'Blocked until the current operator or control-plane blocker is cleared.';
  }
  if (workItem.escalation_status === 'open') {
    return 'Escalation is open. Resolve it before routing successor work or completing this item.';
  }
  const nextActor = workItem.next_expected_actor?.trim();
  const nextAction = workItem.next_expected_action?.trim();
  if (nextActor && nextAction) {
    return `${nextActor} should ${nextAction}.`;
  }
  if (nextActor) {
    return `${nextActor} is the next expected actor.`;
  }
  if (nextAction) {
    return `Next expected action: ${nextAction}.`;
  }
  return null;
}

function WorkItemStageProgressCard(props: { stage: DashboardWorkflowStageRecord }): JSX.Element {
  const progressPercent = readStageProgressPercent(props.stage);
  const completedCount = Math.max(
    0,
    props.stage.total_work_item_count - props.stage.open_work_item_count,
  );

  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-background/70 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Stage progress
          </p>
          <p className="text-sm font-medium text-foreground">
            {completedCount} of {props.stage.total_work_item_count} work items complete in{' '}
            {props.stage.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {progressPercent === null ? 'No percent yet' : `${progressPercent}% complete`}
          </Badge>
          {props.stage.human_gate ? (
            <Badge
              variant={
                props.stage.gate_status === 'approved'
                  ? 'success'
                  : props.stage.gate_status === 'requested' ||
                      props.stage.gate_status === 'awaiting_approval'
                    ? 'warning'
                    : 'outline'
              }
            >
              Gate {props.stage.gate_status}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border/60">
        <div
          className="h-2 rounded-full bg-accent transition-[width]"
          style={{ width: `${readStageProgressWidth(progressPercent)}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs leading-5 text-muted">
        <span>{props.stage.open_work_item_count} open work items still routed here</span>
        <span>
          Iteration {Math.max(1, props.stage.iteration_count)} • {props.stage.status}
        </span>
      </div>
    </div>
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

function MilestoneOperatorSummarySection(props: {
  summary: {
    totalChildren: number;
    completedChildren: number;
    openChildren: number;
    awaitingStepDecisions: number;
    failedSteps: number;
    inFlightSteps: number;
    activeStageNames: string[];
    activeColumnIds: string[];
  };
}): JSX.Element {
  return (
    <section className="grid gap-4 md:grid-cols-3" data-testid="milestone-operator-summary">
      <article className="rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Milestone group summary
        </div>
        <div className={metaRowClass}>
          <Badge variant="outline">
            {describeCountLabel(props.summary.totalChildren, 'child item')}
          </Badge>
          <Badge variant="outline">{props.summary.completedChildren} complete</Badge>
          <Badge variant="outline">{props.summary.openChildren} open</Badge>
        </div>
      </article>
      <article className="rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Operator attention
        </div>
        <div className={metaRowClass}>
          <Badge variant="warning">
            {describeCountLabel(props.summary.awaitingStepDecisions, 'step decision')}
          </Badge>
          <Badge variant="destructive">
            {describeCountLabel(props.summary.failedSteps, 'failed step')}
          </Badge>
          <Badge variant="outline">{props.summary.inFlightSteps} in flight</Badge>
        </div>
      </article>
      <article className="rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Active footprint
        </div>
        <div className={metaRowClass}>
          <Badge variant="outline">
            {props.summary.activeStageNames.length} live stage
            {props.summary.activeStageNames.length === 1 ? '' : 's'}
          </Badge>
          <Badge variant="outline">
            {props.summary.activeColumnIds.length} board column
            {props.summary.activeColumnIds.length === 1 ? '' : 's'}
          </Badge>
        </div>
      </article>
    </section>
  );
}

function WorkItemFocusPacket(props: {
  executionSummary: ReturnType<typeof summarizeWorkItemExecution>;
  artifactCount: number;
  memoryCount: number;
  eventCount: number;
}): JSX.Element {
  const nextMove =
    props.executionSummary.awaitingOperator > 0
      ? 'Open evidence first to clear approvals, requested changes, or escalations before editing board routing.'
      : props.executionSummary.retryableSteps > 0
        ? 'Review evidence for retryable or escalated steps, then return to operator controls for any routing changes.'
        : 'Use operator controls only if the work item needs rerouting or a metadata update. Otherwise stay in the summary packet and keep triage moving.';

  return (
    <section className="grid gap-4 rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm">
      <div className="grid gap-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          Operator snapshot
        </div>
        <strong className="text-base text-foreground">What needs attention next</strong>
        <p className={mutedBodyClass}>{nextMove}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant={props.executionSummary.awaitingOperator > 0 ? 'warning' : 'outline'}>
          {props.executionSummary.awaitingOperator} need decision
        </Badge>
        <Badge variant={props.executionSummary.retryableSteps > 0 ? 'warning' : 'outline'}>
          {props.executionSummary.retryableSteps} retryable
        </Badge>
        <Badge variant="outline">{props.memoryCount} memory packets</Badge>
        <Badge variant="outline">{props.artifactCount} artifacts</Badge>
        <Badge variant="outline">{props.eventCount} history events</Badge>
      </div>
    </section>
  );
}

function WorkItemContinuitySection(props: {
  workItem: DashboardWorkflowWorkItemRecord | null | undefined;
  latestHandoff: DashboardTaskHandoffRecord | null;
  handoffCount: number;
  isLoading: boolean;
}): JSX.Element {
  const continuityFacts = [
    {
      label: 'Current stage',
      value: props.workItem?.stage_name ?? 'Not set',
    },
    {
      label: 'Next expected actor',
      value: props.workItem?.next_expected_actor ?? 'Not set',
    },
    {
      label: 'Next expected action',
      value: props.workItem?.next_expected_action ?? 'Not set',
    },
    {
      label: 'Rework count',
      value: String(props.workItem?.rework_count ?? 0),
    },
    {
      label: 'Subject revision',
      value: String(props.workItem?.current_subject_revision ?? 0),
    },
    {
      label: 'Assessment status',
      value: props.workItem?.assessment_status ?? 'Not set',
    },
    {
      label: 'Gate status',
      value: props.workItem?.gate_status ?? 'Not set',
    },
    {
      label: 'Blocked posture',
      value: props.workItem?.blocked_state ?? 'Clear',
    },
    {
      label: 'Blocked reason',
      value: props.workItem?.blocked_reason ?? 'None',
    },
    {
      label: 'Escalation',
      value: props.workItem?.escalation_status ?? 'Clear',
    },
    {
      label: 'Branch',
      value:
        props.workItem?.branch_id && props.workItem?.branch_status
          ? `${props.workItem.branch_status} • ${props.workItem.branch_id}`
          : props.workItem?.branch_status ?? 'Not branched',
    },
    {
      label: 'Retained assessments',
      value: String(props.workItem?.retained_assessment_count ?? 0),
    },
    {
      label: 'Invalidated assessments',
      value: String(props.workItem?.invalidated_assessment_count ?? 0),
    },
  ];

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <article className={sectionFrameClass}>
        <div className="grid gap-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Current continuity
          </div>
          <strong className="text-base text-foreground">What the platform expects next</strong>
          <p className={mutedBodyClass}>
            This is the persisted continuity state the orchestrator uses between activations.
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {continuityFacts.map((fact) => (
            <div
              key={fact.label}
              className="rounded-lg border border-border/70 bg-background/80 p-3"
            >
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                {fact.label}
              </div>
              <div className="mt-1 text-sm text-foreground">{fact.value}</div>
            </div>
          ))}
        </div>
      </article>
      <article className={sectionFrameClass}>
        <div className="grid gap-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Latest handoff
          </div>
          <strong className="text-base text-foreground">Most recent specialist handoff</strong>
          <p className={mutedBodyClass}>
            Structured handoffs preserve what changed, what remains, and what the next actor should
            inspect.
          </p>
        </div>
        {props.isLoading ? (
          <p className="mt-4 text-sm text-muted">Loading latest handoff…</p>
        ) : props.latestHandoff ? (
          <div className="mt-4 grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{props.latestHandoff.role}</Badge>
              {props.latestHandoff.stage_name ? (
                <Badge variant="outline">{props.latestHandoff.stage_name}</Badge>
              ) : null}
              <Badge variant="secondary">{props.latestHandoff.completion}</Badge>
              {props.latestHandoff.role_data?.resolution || props.latestHandoff.role_data?.decision_state ? (
                <Badge variant="outline">
                  {String(
                    props.latestHandoff.role_data?.decision_state ??
                      props.latestHandoff.role_data?.resolution,
                  ).replaceAll('_', ' ')}
                </Badge>
              ) : null}
              <Badge variant="outline">{props.handoffCount} handoffs</Badge>
            </div>
            <p className="text-sm leading-6 text-foreground">{props.latestHandoff.summary}</p>
            {props.latestHandoff.successor_context ? (
              <div className="rounded-lg border border-border/70 bg-background/80 p-3 text-sm text-muted">
                <div className="font-medium text-foreground">Successor context</div>
                <p className="mt-1 leading-6">{props.latestHandoff.successor_context}</p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 text-xs text-muted">
              <RelativeTimestamp value={props.latestHandoff.created_at} prefix="Submitted" />
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-border/70 bg-background/80 px-4 py-5 text-sm text-muted">
            No handoff recorded yet.
          </div>
        )}
      </article>
    </section>
  );
}

function WorkItemReviewClosure(props: { title: string; detail: string }): JSX.Element {
  return (
    <section className="grid gap-2 rounded-xl border border-dashed border-border/70 bg-background/80 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        Decision checkpoint
      </div>
      <strong className="text-sm text-foreground">{props.title}</strong>
      <p className={mutedBodyClass}>{props.detail}</p>
    </section>
  );
}

function WorkItemHandoffHistorySection(props: {
  handoffs: DashboardTaskHandoffRecord[];
  isLoading: boolean;
}): JSX.Element {
  return (
    <section className={sectionFrameClass}>
      <div className="grid gap-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          Handoff history
        </div>
        <strong className="text-base text-foreground">
          Full execution chain for this work item
        </strong>
        <p className={mutedBodyClass}>
          Review the complete handoff trail when you need to see how work moved between specialists,
          what changed, and what still needs attention.
        </p>
      </div>
      {props.isLoading ? (
        <p className="mt-4 text-sm text-muted">Loading handoff history…</p>
      ) : props.handoffs.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {props.handoffs.map((handoff, index) => (
            <article
              key={handoff.id}
              className="rounded-lg border border-border/70 bg-background/80 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Step {index + 1}</Badge>
                <Badge variant="outline">{handoff.role}</Badge>
                {handoff.stage_name ? <Badge variant="outline">{handoff.stage_name}</Badge> : null}
                <Badge variant="secondary">{handoff.completion}</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-foreground">{handoff.summary}</p>
              {handoff.successor_context ? (
                <div className="mt-3 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm text-muted">
                  <div className="font-medium text-foreground">Successor context</div>
                  <p className="mt-1 leading-6">{handoff.successor_context}</p>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                <Badge variant="outline">
                  {describeCountLabel(handoff.focus_areas.length, 'assessment focus item')}
                </Badge>
                <Badge variant="outline">
                  {describeCountLabel(handoff.remaining_items.length, 'remaining item')}
                </Badge>
                <Badge variant="outline">
                  {describeCountLabel(handoff.blockers.length, 'blocker')}
                </Badge>
                <RelativeTimestamp value={handoff.created_at} prefix="Submitted" />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border/70 bg-background/80 px-4 py-5 text-sm text-muted">
          No handoff history recorded yet.
        </div>
      )}
    </section>
  );
}

function readStageProgressPercent(stage: DashboardWorkflowStageRecord): number | null {
  if (stage.total_work_item_count <= 0) {
    return null;
  }
  const completedCount = Math.max(0, stage.total_work_item_count - stage.open_work_item_count);
  return Math.min(
    100,
    Math.max(0, Math.round((completedCount / stage.total_work_item_count) * 100)),
  );
}

function readStageProgressWidth(percent: number | null): number {
  if (percent === null) {
    return 0;
  }
  if (percent === 0) {
    return 4;
  }
  return percent;
}

function WorkItemTasksSection(props: {
  workflowId: string;
  workItemId: string;
  tasks: DashboardWorkItemTaskRecord[];
  executionSummary: ReturnType<typeof summarizeWorkItemExecution>;
  isMilestone: boolean;
  childCount: number;
  onWorkItemChanged(): Promise<unknown> | unknown;
}): JSX.Element {
  const executionSummary = props.executionSummary;
  const orderedTasks = useMemo(() => sortTasksForOperatorReview(props.tasks), [props.tasks]);
  const agentsQuery = useQuery({
    queryKey: ['workflow-work-item-agents', props.workflowId],
    queryFn: () => dashboardApi.listAgents(),
    staleTime: 60_000,
  });
  const attentionTasks = orderedTasks.filter(
    (task) =>
      task.state === 'awaiting_approval' ||
      task.state === 'output_pending_assessment' ||
      task.state === 'failed' ||
      task.state === 'escalated',
  );

  if (props.tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
        No execution steps are linked to this work item yet.
      </div>
    );
  }

  return (
    <section className="grid gap-4 rounded-xl border border-border/70 bg-surface p-4 shadow-sm">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DetailStatCard
            label="Linked steps"
            value={String(executionSummary.totalSteps)}
            detail="Execution records anchored here"
          />
          <DetailStatCard
            label="Needs decision"
            value={String(executionSummary.awaitingOperator)}
            detail="Operator decisions still needed"
          />
          <DetailStatCard
            label="Retryable"
            value={String(executionSummary.retryableSteps)}
            detail="Failed or escalated steps"
          />
          <DetailStatCard
            label="In flight"
            value={String(executionSummary.activeSteps)}
            detail="Ready, blocked, or in progress"
          />
        </div>
        <div className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm">Execution decision packet</strong>
            <Badge variant="outline">{executionSummary.completedSteps} completed</Badge>
          </div>
          <p className={mutedBodyClass}>
            Roles and stage coverage stay visible here so operators can spot ownership gaps before
            opening individual step records.
          </p>
          <div className="grid gap-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              Roles in play
            </div>
            <div className="flex flex-wrap gap-2">
              {executionSummary.distinctRoles.length > 0 ? (
                executionSummary.distinctRoles.map((role) => (
                  <Badge key={role} variant="outline">
                    {role}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted">No roles assigned yet.</span>
              )}
            </div>
          </div>
          <div className="grid gap-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              Stage coverage
            </div>
            <div className="flex flex-wrap gap-2">
              {executionSummary.distinctStages.length > 0 ? (
                executionSummary.distinctStages.map((stageName) => (
                  <Badge key={stageName} variant="outline">
                    {stageName}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted">No stages assigned yet.</span>
              )}
            </div>
          </div>
        </div>
      </div>
      {attentionTasks.length > 0 ? (
        <div className="grid gap-3 rounded-xl border border-amber-300/70 bg-amber-50/80 p-4 dark:border-amber-900/70 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <strong className="text-base">Requires operator attention</strong>
              <p className={mutedBodyClass}>
                The highest-urgency steps are pinned here first so approvals and retries do not get
                buried below routine execution.
              </p>
            </div>
            <Badge variant="warning">{attentionTasks.length} queued for decision</Badge>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {attentionTasks.slice(0, 4).map((task) => {
              const posture = describeTaskOperatorPosture(task);
              return (
                <article
                  key={`attention:${task.id}`}
                  className="grid gap-2 rounded-xl border border-border/70 bg-background/90 p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-2">
                      <Link to={`/work/tasks/${task.id}`} className="font-medium text-foreground">
                        {task.title}
                      </Link>
                      <CopyableIdBadge value={task.id} label="Step" />
                    </div>
                    <OperatorStatusBadge status={task.state} />
                  </div>
                  <p className="text-sm leading-6 text-muted">{posture.detail}</p>
                  <div className="flex flex-wrap gap-2">
                    {task.role ? <Badge variant="outline">{task.role}</Badge> : null}
                    {task.stage_name ? <Badge variant="outline">{task.stage_name}</Badge> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="grid gap-2">
        <strong className="text-base">Execution queue</strong>
        <p className={mutedBodyClass}>
          Steps are ordered by operator urgency so approvals, escalations, and retries appear before
          background progress updates.
        </p>
      </div>
      {props.isMilestone ? (
        <p className={mutedBodyClass}>
          Showing execution steps linked to this milestone and its {props.childCount} child work
          items.
        </p>
      ) : (
        <p className={mutedBodyClass}>
          Linked execution steps stay here so approvals, rework, and retries remain anchored to the
          selected work item.
        </p>
      )}
      <div className="grid gap-3 lg:hidden">
        {orderedTasks.map((task) => (
          <TaskExecutionCard
            key={task.id}
            workflowId={props.workflowId}
            workItemId={props.workItemId}
            task={task}
            agents={agentsQuery.data ?? []}
            isLoadingAgents={agentsQuery.isLoading}
            onWorkItemChanged={props.onWorkItemChanged}
          />
        ))}
      </div>
      <div className="hidden overflow-x-auto lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Step</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Dependencies</TableHead>
              <TableHead>Operator flow</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orderedTasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell>
                  <div className="grid gap-2">
                    <Link to={`/work/tasks/${task.id}`}>{task.title}</Link>
                    <CopyableIdBadge value={task.id} label="Step" />
                  </div>
                </TableCell>
                <TableCell>
                  <OperatorStatusBadge status={task.state} />
                </TableCell>
                <TableCell>{task.role ?? 'Unassigned'}</TableCell>
                <TableCell>{task.stage_name ?? 'unassigned'}</TableCell>
                <TableCell>
                  {task.depends_on.length > 0 ? task.depends_on.join(', ') : '—'}
                </TableCell>
                <TableCell className="min-w-[18rem]">
                  <WorkItemTaskActionCell
                    workflowId={props.workflowId}
                    workItemId={props.workItemId}
                    task={task}
                    agents={agentsQuery.data ?? []}
                    isLoadingAgents={agentsQuery.isLoading}
                    onWorkItemChanged={props.onWorkItemChanged}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function TaskExecutionCard(props: {
  workflowId: string;
  workItemId: string;
  task: DashboardWorkItemTaskRecord;
  agents: DashboardAgentRecord[];
  isLoadingAgents: boolean;
  onWorkItemChanged(): Promise<unknown> | unknown;
}): JSX.Element {
  return (
    <article className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-2">
          <div className="grid gap-2">
            <Link
              to={`/work/tasks/${props.task.id}`}
              className="text-base font-semibold text-foreground"
            >
              {props.task.title}
            </Link>
            <CopyableIdBadge value={props.task.id} label="Step" />
          </div>
          <div className={metaRowClass}>
            <OperatorStatusBadge status={props.task.state} />
            <Badge variant="outline">{props.task.role ?? 'Unassigned'}</Badge>
            <Badge variant="outline">{props.task.stage_name ?? 'unassigned'}</Badge>
          </div>
        </div>
        <TaskDependencySummary task={props.task} />
      </div>
      <WorkItemTaskActionCell
        workflowId={props.workflowId}
        workItemId={props.workItemId}
        task={props.task}
        agents={props.agents}
        isLoadingAgents={props.isLoadingAgents}
        onWorkItemChanged={props.onWorkItemChanged}
      />
    </article>
  );
}

function TaskDependencySummary(props: { task: DashboardWorkItemTaskRecord }): JSX.Element {
  if (props.task.depends_on.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-xs text-muted">
        No dependencies
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-lg border border-border/70 bg-background/80 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        Dependencies
      </div>
      <div className="flex flex-wrap gap-2">
        {props.task.depends_on.map((dependency) => (
          <Badge key={dependency} variant="outline">
            {dependency}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function WorkItemTaskActionCell(props: {
  workflowId: string;
  workItemId: string;
  task: DashboardWorkItemTaskRecord;
  agents: DashboardAgentRecord[];
  isLoadingAgents: boolean;
  onWorkItemChanged(): Promise<unknown> | unknown;
}): JSX.Element {
  const [isChangesDialogOpen, setIsChangesDialogOpen] = useState(false);
  const [isEscalationDialogOpen, setIsEscalationDialogOpen] = useState(false);
  const [isOutputOverrideDialogOpen, setIsOutputOverrideDialogOpen] = useState(false);
  const [isReassignDialogOpen, setIsReassignDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [instructions, setInstructions] = useState('');
  const [outputOverrideDraft, setOutputOverrideDraft] = useState(formatOutputOverrideDraft(undefined));
  const [outputOverrideReason, setOutputOverrideReason] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [reassignAgentId, setReassignAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = props.task.state;
  const scopedWorkItemId = props.task.work_item_id ?? props.workItemId;
  const taskLinks = buildWorkItemTaskLinkActions({
    workflowId: props.workflowId,
    taskId: props.task.id,
    workItemId: props.task.work_item_id,
    state,
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      state === 'output_pending_assessment'
        ? dashboardApi.approveWorkflowWorkItemTaskOutput(
            props.workflowId,
            scopedWorkItemId,
            props.task.id,
          )
        : dashboardApi.approveWorkflowWorkItemTask(
            props.workflowId,
            scopedWorkItemId,
            props.task.id,
          ),
    onSuccess: async () => {
      setError(null);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to approve step.');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () =>
      dashboardApi.rejectWorkflowWorkItemTask(props.workflowId, scopedWorkItemId, props.task.id, {
        feedback,
      }),
    onSuccess: async () => {
      setError(null);
      setFeedback('');
      setIsChangesDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to reject step.');
    },
  });

  const requestChangesMutation = useMutation({
    mutationFn: () =>
      dashboardApi.requestWorkflowWorkItemTaskChanges(
        props.workflowId,
        scopedWorkItemId,
        props.task.id,
        { feedback },
      ),
    onSuccess: async () => {
      setError(null);
      setFeedback('');
      setIsChangesDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error ? mutationError.message : 'Failed to request changes.',
      );
    },
  });
  const overrideOutputMutation = useMutation({
    mutationFn: () =>
      dashboardApi.overrideWorkflowWorkItemTaskOutput(
        props.workflowId,
        scopedWorkItemId,
        props.task.id,
        {
          output: parseOutputOverrideDraft(outputOverrideDraft),
          reason: outputOverrideReason.trim(),
        },
      ),
    onSuccess: async () => {
      setError(null);
      setOutputOverrideDraft(formatOutputOverrideDraft(undefined));
      setOutputOverrideReason('');
      setIsOutputOverrideDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error ? mutationError.message : 'Failed to override output.',
      );
    },
  });
  const reassignMutation = useMutation({
    mutationFn: () => {
      const selectedAgentId = reassignAgentId?.trim();
      if (!selectedAgentId) {
        throw new Error('Select an agent before reassigning this step.');
      }
      const reason = reassignReason.trim();
      if (!reason) {
        throw new Error('Add a reason before reassigning this step.');
      }
      return dashboardApi.reassignWorkflowWorkItemTask(
        props.workflowId,
        scopedWorkItemId,
        props.task.id,
        {
          preferred_agent_id: selectedAgentId,
          reason,
        },
      );
    },
    onSuccess: async () => {
      setError(null);
      setReassignReason('');
      setReassignAgentId(null);
      setIsReassignDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to reassign step.');
    },
  });
  const resolveEscalationMutation = useMutation({
    mutationFn: () =>
      dashboardApi.resolveWorkflowWorkItemTaskEscalation(
        props.workflowId,
        scopedWorkItemId,
        props.task.id,
        { instructions: instructions.trim() },
      ),
    onSuccess: async () => {
      setError(null);
      setInstructions('');
      setIsEscalationDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error ? mutationError.message : 'Failed to resume escalated step.',
      );
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () =>
      dashboardApi.cancelWorkflowWorkItemTask(props.workflowId, scopedWorkItemId, props.task.id),
    onSuccess: async () => {
      setError(null);
      setFeedback('');
      setInstructions('');
      setOutputOverrideDraft(formatOutputOverrideDraft(undefined));
      setOutputOverrideReason('');
      setReassignReason('');
      setReassignAgentId(null);
      setIsChangesDialogOpen(false);
      setIsEscalationDialogOpen(false);
      setIsOutputOverrideDialogOpen(false);
      setIsReassignDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to cancel step.');
    },
  });

  const canApprove = state === 'awaiting_approval' || state === 'output_pending_assessment';
  const canOverrideOutput = state === 'output_pending_assessment';
  const canRequestChanges =
    state === 'awaiting_approval' || state === 'output_pending_assessment' || state === 'failed';
  const canResolveEscalation = state === 'escalated';
  const canCancel = state === 'failed' || state === 'escalated' || state === 'in_progress';
  const canReassign = state !== 'completed' && state !== 'cancelled';
  const isAnyMutationPending =
    approveMutation.isPending ||
    overrideOutputMutation.isPending ||
    rejectMutation.isPending ||
    requestChangesMutation.isPending ||
    reassignMutation.isPending ||
    resolveEscalationMutation.isPending ||
    cancelMutation.isPending;

  return (
    <div className="grid gap-3">
      <TaskOperatorPosturePanel task={props.task} />
      <div className={metaRowClass}>
        {taskLinks.map((action) => (
          <Link key={`${props.task.id}:${action.label}`} to={action.href}>
            {action.label}
          </Link>
        ))}
      </div>
      <div className={metaRowClass}>
        {canApprove ? (
          <Button
            size="sm"
            onClick={() => approveMutation.mutate()}
            disabled={isAnyMutationPending}
          >
            {state === 'output_pending_assessment' ? 'Approve Output' : 'Approve Step'}
          </Button>
        ) : null}
        {canOverrideOutput ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setError(null);
              setOutputOverrideDraft(formatOutputOverrideDraft(undefined));
              setOutputOverrideReason('');
              setIsOutputOverrideDialogOpen(true);
            }}
            disabled={isAnyMutationPending}
          >
            Override Output
          </Button>
        ) : null}
        {canRequestChanges ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsChangesDialogOpen(true)}
            disabled={isAnyMutationPending}
          >
            Request Changes
          </Button>
        ) : null}
        {canResolveEscalation ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsEscalationDialogOpen(true)}
            disabled={isAnyMutationPending}
          >
            Resume with Guidance
          </Button>
        ) : null}
        {canReassign ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsReassignDialogOpen(true)}
            disabled={isAnyMutationPending}
          >
            Reassign Step
          </Button>
        ) : null}
        {canCancel ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => cancelMutation.mutate()}
            disabled={isAnyMutationPending}
          >
            Cancel Step
          </Button>
        ) : null}
      </div>
      {error ? <p className={errorTextClass}>{error}</p> : null}
      <StepChangesDialog
        isOpen={isChangesDialogOpen}
        state={state}
        taskTitle={props.task.title}
        feedback={feedback}
        isPending={isAnyMutationPending}
        onOpenChange={setIsChangesDialogOpen}
        onFeedbackChange={setFeedback}
        onReject={() => rejectMutation.mutate()}
        onRequestChanges={() => requestChangesMutation.mutate()}
      />
      <StepEscalationDialog
        isOpen={isEscalationDialogOpen}
        taskTitle={props.task.title}
        instructions={instructions}
        isPending={isAnyMutationPending}
        onOpenChange={setIsEscalationDialogOpen}
        onInstructionsChange={setInstructions}
        onSubmit={() => resolveEscalationMutation.mutate()}
      />
      <StepOutputOverrideDialog
        isOpen={isOutputOverrideDialogOpen}
        taskTitle={props.task.title}
        description={`Override the stored output packet for “${props.task.title}” without leaving the selected work-item flow.`}
        outputDraft={outputOverrideDraft}
        reason={outputOverrideReason}
        error={isOutputOverrideDialogOpen ? error : null}
        isPending={isAnyMutationPending}
        onOpenChange={(open) => {
          setIsOutputOverrideDialogOpen(open);
          if (!open) {
            setOutputOverrideDraft(formatOutputOverrideDraft(undefined));
            setOutputOverrideReason('');
          }
        }}
        onOutputDraftChange={setOutputOverrideDraft}
        onReasonChange={setOutputOverrideReason}
        onSubmit={() => overrideOutputMutation.mutate()}
      />
      <WorkItemReassignDialog
        isOpen={isReassignDialogOpen}
        taskTitle={props.task.title}
        agents={props.agents}
        selectedAgentId={reassignAgentId}
        reason={reassignReason}
        isLoadingAgents={props.isLoadingAgents}
        isPending={isAnyMutationPending}
        onOpenChange={(open) => {
          setIsReassignDialogOpen(open);
          if (!open) {
            setReassignReason('');
            setReassignAgentId(null);
          }
        }}
        onAgentChange={setReassignAgentId}
        onReasonChange={setReassignReason}
        onSubmit={() => reassignMutation.mutate()}
      />
    </div>
  );
}

function MilestoneChildrenSection(props: {
  children: DashboardGroupedWorkItemRecord[];
  onSelectWorkItem(workItemId: string): void;
}): JSX.Element {
  const groupedByStage = props.children.reduce<Record<string, DashboardGroupedWorkItemRecord[]>>(
    (acc, child) => {
      const key = child.stage_name ?? 'unassigned';
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(child);
      return acc;
    },
    {},
  );

  return (
    <section className="grid gap-4 rounded-xl border border-border/70 bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-base">Milestone children</strong>
        <Badge variant="outline">{describeCountLabel(props.children.length, 'item')}</Badge>
      </div>
      <p className={mutedBodyClass}>
        Child work items inherit this milestone’s operator context but can move independently across
        the board.
      </p>
      {props.children.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
          No child work items are linked to this milestone yet.
        </div>
      ) : (
        Object.entries(groupedByStage).map(([stageName, children]) => (
          <div key={stageName} className="grid gap-3">
            <div className={metaRowClass}>
              <Badge variant="outline">Stage group</Badge>
              <strong>{stageName}</strong>
              <span className="text-sm text-muted">
                {describeCountLabel(children.length, 'child item')}
              </span>
            </div>
            {children.map((child) => (
              <article
                key={child.id}
                className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto justify-start px-0 text-left text-base font-semibold"
                    onClick={() => props.onSelectWorkItem(child.id)}
                  >
                    {child.title}
                  </Button>
                  <div className={metaRowClass}>
                    <Badge variant="outline">{child.column_id}</Badge>
                    {child.completed_at ? <Badge variant="secondary">completed</Badge> : null}
                  </div>
                </div>
                <div className={metaRowClass}>
                  <Badge variant="outline">Open child work-item flow</Badge>
                </div>
                {child.goal ? <p className={mutedBodyClass}>{child.goal}</p> : null}
              </article>
            ))}
          </div>
        ))
      )}
    </section>
  );
}

function WorkItemArtifactsSection(props: {
  isLoading: boolean;
  hasError: boolean;
  tasks: DashboardWorkItemTaskRecord[];
  artifacts: DashboardWorkItemArtifactRecord[];
}): JSX.Element {
  if (props.isLoading) {
    return <p className={loadingTextClass}>Loading work-item artifacts...</p>;
  }
  if (props.hasError) {
    return <p className={errorTextClass}>Failed to load work-item artifacts.</p>;
  }
  if (props.tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
        Artifacts appear after linked steps upload them.
      </div>
    );
  }
  if (props.artifacts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
        No artifacts recorded for this work item yet.
      </div>
    );
  }

  return (
    <section className="grid gap-3 rounded-xl border border-border/70 bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-base">Artifacts</strong>
        <Badge variant="outline">
          {describeCountLabel(props.artifacts.length, 'previewable output')}
        </Badge>
      </div>
      {props.artifacts.map((artifact) => (
        <article
          key={artifact.id}
          className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <ArtifactIdentity artifact={artifact} />
            <Badge variant="outline">{artifact.content_type}</Badge>
          </div>
          <div className={metaRowClass}>
            <Badge variant="outline">{artifact.task_title}</Badge>
            <Badge variant="outline">{artifact.size_bytes} bytes</Badge>
            <CopyableIdBadge value={artifact.id} label="Artifact" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <RelativeTimestamp value={artifact.created_at} prefix="Created" />
            <Link to={buildArtifactPermalink(artifact.task_id, artifact.id)}>Preview artifact</Link>
          </div>
        </article>
      ))}
    </section>
  );
}

function MemoryEmptyState(props: {
  title: string;
  badge: string;
  summary: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-xl border border-dashed border-border/70 bg-border/5 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-1">
          <strong className="text-sm">{props.title}</strong>
          <p className={mutedBodyClass}>{props.summary}</p>
        </div>
        <Badge variant="outline">{props.badge}</Badge>
      </div>
      <div className="rounded-lg border border-border/70 bg-surface/80 p-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
          What shows up here
        </p>
        <p className="mt-2 text-sm leading-6 text-muted">{props.detail}</p>
      </div>
    </div>
  );
}

function ArtifactIdentity(props: { artifact: DashboardWorkItemArtifactRecord }): JSX.Element {
  const identity = describeWorkItemArtifactIdentity(props.artifact.logical_path);
  return (
    <div className="grid gap-1">
      <strong className="break-all">{identity.fileName}</strong>
      {identity.displayPath ? <CopyableIdBadge value={identity.displayPath} label="Path" /> : null}
    </div>
  );
}

function formatMemoryHistoryEventType(eventType: string): string {
  if (eventType === 'deleted') {
    return 'Deleted value';
  }
  if (eventType === 'created') {
    return 'Created value';
  }
  return 'Updated value';
}

function StructuredValueReview(props: {
  label: string;
  value: unknown;
  emptyMessage: string;
  disclosureLabel: string;
}): JSX.Element {
  const summary = summarizeStructuredValue(props.value);
  if (!summary.hasValue) {
    return <p className={mutedBodyClass}>{props.emptyMessage}</p>;
  }

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-background/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {props.label}
          </div>
          <p className={mutedBodyClass}>{summary.detail}</p>
        </div>
        <Badge variant="outline">{summary.shapeLabel}</Badge>
      </div>
      {summary.scalarFacts.length > 0 ? (
        <dl className="grid gap-2 sm:grid-cols-2">
          {summary.scalarFacts.map((fact) => (
            <div
              key={`${props.label}:${fact.label}`}
              className="grid gap-1 rounded-lg border border-border/70 bg-surface px-3 py-2"
            >
              <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                {fact.label}
              </dt>
              <dd className="text-sm text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {summary.keyHighlights.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {summary.keyHighlights.map((key) => (
            <Badge key={`${props.label}:${key}`} variant="outline">
              {key}
            </Badge>
          ))}
        </div>
      ) : null}
      <details className="rounded-lg border border-border/70 bg-surface px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          {props.disclosureLabel}
        </summary>
        <div className="mt-3">
          <StructuredRecordView data={props.value} emptyMessage={props.emptyMessage} />
        </div>
      </details>
    </div>
  );
}

function DetailStatCard(props: { label: string; value: string; detail: string }): JSX.Element {
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

function TaskOperatorPosturePanel(props: { task: DashboardWorkItemTaskRecord }): JSX.Element {
  const posture = describeTaskOperatorPosture(props.task);
  return (
    <div className="grid gap-1 rounded-lg border border-border/70 bg-background/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          Operator next step
        </div>
        <Badge variant={posture.tone}>{posture.title}</Badge>
      </div>
      <p className="text-xs leading-5 text-muted">{posture.detail}</p>
    </div>
  );
}
