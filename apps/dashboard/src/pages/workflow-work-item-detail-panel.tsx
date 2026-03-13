import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import {
  dashboardApi,
  type DashboardWorkItemMemoryEntry,
  type DashboardWorkItemMemoryHistoryEntry,
  type DashboardWorkflowBoardColumn,
  type DashboardWorkflowStageRecord,
  type DashboardWorkflowWorkItemRecord,
} from '../lib/api.js';
import { buildArtifactPermalink } from '../components/artifact-preview-support.js';
import {
  CopyableIdBadge,
  OperatorStatusBadge,
  RelativeTimestamp,
} from '../components/operator-display.js';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';
import { cn } from '../lib/utils.js';
import type { StructuredEntryDraft } from './projects/project-detail-support.js';
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
} from './workflow-work-item-task-review-dialogs.js';
import {
  buildWorkItemBreadcrumbs,
  describeTaskOperatorPosture,
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

const sectionFrameClass =
  'rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm';
const metaRowClass = 'flex flex-wrap items-center gap-2';
const mutedBodyClass = 'text-sm leading-6 text-muted';
const fieldStackClass = 'grid gap-2';
const loadingTextClass = 'rounded-lg border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted';
const errorTextClass = 'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700';

export function WorkflowWorkItemDetailPanel(
  props: WorkflowWorkItemDetailPanelProps,
): JSX.Element {
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
    queryFn: () => dashboardApi.getWorkflowWorkItemMemoryHistory(props.workflowId, props.workItemId),
    enabled: props.workflowId.length > 0 && props.workItemId.length > 0,
  });

  const workItem = workItemQuery.data;
  const events = useMemo(
    () => sortEventsNewestFirst(eventQuery.data ?? []),
    [eventQuery.data],
  );
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
          !item.parent_work_item_id &&
          item.id !== props.workItemId &&
          isMilestoneWorkItem(item),
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
  const [stageName, setStageName] = useState('');
  const [columnId, setColumnId] = useState('');
  const [ownerRole, setOwnerRole] = useState('');
  const [parentWorkItemId, setParentWorkItemId] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<WorkItemPriority>(
    normalizeWorkItemPriority(undefined),
  );
  const [metadataDrafts, setMetadataDrafts] = useState<StructuredEntryDraft[]>([]);
  const [lockedMetadataDraftIds, setLockedMetadataDraftIds] = useState<string[]>([]);
  const [childTitle, setChildTitle] = useState('');
  const [childGoal, setChildGoal] = useState('');
  const [childAcceptanceCriteria, setChildAcceptanceCriteria] = useState('');
  const [childNotes, setChildNotes] = useState('');
  const [childPriority, setChildPriority] = useState<WorkItemPriority>(
    normalizeWorkItemPriority(undefined),
  );
  const [childMetadataDrafts, setChildMetadataDrafts] = useState<
    StructuredEntryDraft[]
  >([]);
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
    const metadataState = createWorkItemMetadataDraftState(
      workItem?.metadata ?? source?.metadata,
    );
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
    ((canEditParent ? boardWorkItem?.parent_work_item_id ?? workItem?.parent_work_item_id ?? '' : '') !==
      (canEditParent ? parentWorkItemId : ''));
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
        canCreateChild:
          childTitle.trim().length > 0 && childMetadataValidation.isValid,
        message: operatorMessage,
        error: operatorError,
      } satisfies Parameters<typeof WorkItemOperatorSection>[0])
    : null;

  return (
    <Card
      className="overflow-hidden border-accent/30 bg-surface/95 shadow-lg ring-1 ring-accent/10"
      data-testid="work-item-detail-shell"
      data-selected-panel="true"
    >
      <CardHeader className="gap-4 border-b border-border/70 bg-gradient-to-br from-surface via-surface to-border/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="grid gap-3">
            <div className={metaRowClass}>
              <Badge variant="secondary">Selected work item</Badge>
              <Badge variant="outline">{props.tasks.length} linked steps</Badge>
              {artifactQuery.data ? (
                <Badge variant="outline">{artifactQuery.data.length} artifacts</Badge>
              ) : null}
            </div>
            <div className="grid gap-2">
              <CardTitle className="text-xl">Work Item Detail</CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6">
                Operator view of the selected work item, including linked execution steps,
                artifacts, event history, and scoped memory.
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" onClick={props.onClearSelection}>
            Clear Selection
          </Button>
        </div>
      </CardHeader>

      <CardContent className="grid gap-6 p-5">
        {workItemQuery.isLoading ? (
          <p className={loadingTextClass}>Loading work item...</p>
        ) : null}
        {workItemQuery.error ? (
          <p className={errorTextClass}>Failed to load work item detail.</p>
        ) : null}
        {workItem ? (
          <WorkItemHeader
            workItem={boardWorkItem ?? workItem}
            breadcrumbs={workItemBreadcrumbs}
            childCount={milestoneChildren.length}
            linkedTaskCount={props.tasks.length}
            artifactCount={artifactQuery.data?.length ?? 0}
            stages={props.stages}
            onSelectWorkItem={props.onSelectWorkItem}
          />
        ) : null}

        {milestoneOperatorSummary ? (
          <MilestoneOperatorSummarySection summary={milestoneOperatorSummary} />
        ) : null}

        {operatorSectionProps ? <WorkItemOperatorSection {...operatorSectionProps} /> : null}

        <Tabs
          defaultValue="steps"
          className="grid gap-4"
          data-testid="work-item-detail-tabs"
        >
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-xl border border-border/70 bg-border/10 p-1 xl:grid-cols-4">
            <TabsTrigger value="steps">Steps</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
            <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
            <TabsTrigger value="history">Event History</TabsTrigger>
          </TabsList>

          <TabsContent value="steps" className="mt-0 grid">
            <WorkItemTasksSection
              workflowId={props.workflowId}
              tasks={props.tasks}
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

        {isMilestoneWorkItem(boardWorkItem) ? (
          <MilestoneChildrenSection
            children={milestoneChildren}
            onSelectWorkItem={props.onSelectWorkItem}
          />
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
        Adjust board placement, stage ownership, and milestone nesting without leaving the work-item operator view.
      </p>
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
            <p className="text-xs leading-5 text-muted">
              {selectedPriority?.description}
            </p>
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className={fieldStackClass}>
              <span className="text-sm font-medium text-foreground">
                Acceptance criteria
              </span>
              <Textarea
                value={props.acceptanceCriteria}
                onChange={(event) =>
                  props.onAcceptanceCriteriaChange(event.target.value)
                }
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
              <span className="text-sm font-medium text-foreground">Reparent under milestone</span>
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
              Parent milestones stay top-level. Move or reparent child work items instead of nesting milestones.
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
      {props.isMilestone ? (
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
                  placeholder="Capture implementation notes or operator guidance for the child item."
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
              <Button onClick={props.onCreateChild} disabled={!props.canCreateChild || props.isCreatingChild}>
                {props.isCreatingChild ? 'Creating…' : 'Create Child Work Item'}
              </Button>
            </div>
          </div>
        </OperatorSectionCard>
      ) : null}
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
          <Badge variant="outline">{props.entries.length} entries</Badge>
        </div>
        {props.entries.length === 0 ? (
          <p className={mutedBodyClass}>No work-item memory entries recorded yet.</p>
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
          <Badge variant="outline">{props.history.length} events</Badge>
        </div>
        {props.isHistoryLoading ? <p className={loadingTextClass}>Loading memory history...</p> : null}
        {props.hasHistoryError ? (
          <p className={errorTextClass}>Failed to load work-item memory history.</p>
        ) : null}
        {!props.isHistoryLoading && !props.hasHistoryError && props.history.length === 0 ? (
          <p className={mutedBodyClass}>No work-item memory history recorded yet.</p>
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
  const completedChildren = workItem.children_completed ?? workItem.children?.filter((child) => child.completed_at).length ?? 0;
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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DetailStatCard
          label="Stage group"
          value={workItem.stage_name ?? 'Unassigned'}
          detail="Current stage routing"
        />
        <DetailStatCard
          label="Board placement"
          value={workItem.column_id ?? 'Unassigned'}
          detail="Active board column"
        />
        <DetailStatCard
          label="Execution steps"
          value={String(props.linkedTaskCount)}
          detail="Linked operator-visible steps"
        />
        <DetailStatCard
          label="Artifacts"
          value={String(props.artifactCount)}
          detail="Previewable outputs"
        />
      </div>
      {stageRecord ? <WorkItemStageProgressCard stage={stageRecord} /> : null}
      <div className={metaRowClass}>
        {workItem.owner_role ? <Badge variant="outline">{workItem.owner_role}</Badge> : null}
        {workItem.task_count !== undefined ? (
          <Badge variant="outline">{workItem.task_count} linked steps</Badge>
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

function WorkItemStageProgressCard(props: {
  stage: DashboardWorkflowStageRecord;
}): JSX.Element {
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

function MilestoneOperatorSummarySection(props: {
  summary: {
    totalChildren: number;
    completedChildren: number;
    openChildren: number;
    awaitingStepReviews: number;
    failedSteps: number;
    inFlightSteps: number;
    activeStageNames: string[];
    activeColumnIds: string[];
  };
}): JSX.Element {
  return (
    <section
      className="grid gap-4 md:grid-cols-3"
      data-testid="milestone-operator-summary"
    >
      <article className="rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Milestone group summary
        </div>
        <div className={metaRowClass}>
          <Badge variant="outline">{props.summary.totalChildren} child items</Badge>
          <Badge variant="outline">{props.summary.completedChildren} complete</Badge>
          <Badge variant="outline">{props.summary.openChildren} open</Badge>
        </div>
      </article>
      <article className="rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Operator attention
        </div>
        <div className={metaRowClass}>
          <Badge variant="warning">{props.summary.awaitingStepReviews} step reviews</Badge>
          <Badge variant="destructive">{props.summary.failedSteps} failed steps</Badge>
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

function readStageProgressPercent(stage: DashboardWorkflowStageRecord): number | null {
  if (stage.total_work_item_count <= 0) {
    return null;
  }
  const completedCount = Math.max(0, stage.total_work_item_count - stage.open_work_item_count);
  return Math.min(100, Math.max(0, Math.round((completedCount / stage.total_work_item_count) * 100)));
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
  tasks: DashboardWorkItemTaskRecord[];
  isMilestone: boolean;
  childCount: number;
  onWorkItemChanged(): Promise<unknown> | unknown;
}): JSX.Element {
  const executionSummary = useMemo(
    () => summarizeWorkItemExecution(props.tasks),
    [props.tasks],
  );
  const orderedTasks = useMemo(
    () => sortTasksForOperatorReview(props.tasks),
    [props.tasks],
  );
  const attentionTasks = orderedTasks.filter((task) =>
    task.state === 'awaiting_approval' ||
    task.state === 'output_pending_review' ||
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
            label="Needs review"
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
            <strong className="text-sm">Execution review packet</strong>
            <Badge variant="outline">{executionSummary.completedSteps} completed</Badge>
          </div>
          <p className={mutedBodyClass}>
            Roles and stage coverage stay visible here so operators can spot ownership gaps
            before opening individual step records.
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
                The highest-urgency steps are pinned here first so approvals and retries do not
                get buried below routine execution.
              </p>
            </div>
            <Badge variant="warning">{attentionTasks.length} queued for review</Badge>
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
          Steps are ordered by operator urgency so approvals, escalations, and retries appear
          before background progress updates.
        </p>
      </div>
      {props.isMilestone ? (
        <p className={mutedBodyClass}>
          Showing execution steps linked to this milestone and its {props.childCount} child work items.
        </p>
      ) : (
        <p className={mutedBodyClass}>
          Linked execution steps stay here so approvals, rework, and retries remain anchored to the selected work item.
        </p>
      )}
      <div className="grid gap-3 lg:hidden">
        {orderedTasks.map((task) => (
          <TaskExecutionCard
            key={task.id}
            workflowId={props.workflowId}
            task={task}
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
                <TableCell>{task.depends_on.length > 0 ? task.depends_on.join(', ') : '—'}</TableCell>
                <TableCell className="min-w-[18rem]">
                  <WorkItemTaskActionCell
                    workflowId={props.workflowId}
                    task={task}
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
  task: DashboardWorkItemTaskRecord;
  onWorkItemChanged(): Promise<unknown> | unknown;
}): JSX.Element {
  return (
    <article className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-2">
          <div className="grid gap-2">
            <Link to={`/work/tasks/${props.task.id}`} className="text-base font-semibold text-foreground">
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
        task={props.task}
        onWorkItemChanged={props.onWorkItemChanged}
      />
    </article>
  );
}

function TaskDependencySummary(props: {
  task: DashboardWorkItemTaskRecord;
}): JSX.Element {
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
  task: DashboardWorkItemTaskRecord;
  onWorkItemChanged(): Promise<unknown> | unknown;
}): JSX.Element {
  const [isChangesDialogOpen, setIsChangesDialogOpen] = useState(false);
  const [isEscalationDialogOpen, setIsEscalationDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const state = props.task.state;
  const taskLinks = buildWorkItemTaskLinkActions({
    workflowId: props.workflowId,
    taskId: props.task.id,
    workItemId: props.task.work_item_id,
    state,
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      state === 'output_pending_review'
        ? dashboardApi.approveTaskOutput(props.task.id)
        : dashboardApi.approveTask(props.task.id),
    onSuccess: async () => {
      setError(null);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to approve step.');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => dashboardApi.rejectTask(props.task.id, { feedback }),
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
    mutationFn: () => dashboardApi.requestTaskChanges(props.task.id, { feedback }),
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

  const retryMutation = useMutation({
    mutationFn: () => dashboardApi.retryTask(props.task.id),
    onSuccess: async () => {
      setError(null);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to retry step.');
    },
  });
  const resolveEscalationMutation = useMutation({
    mutationFn: () =>
      dashboardApi.resolveEscalation(props.task.id, { instructions: instructions.trim() }),
    onSuccess: async () => {
      setError(null);
      setInstructions('');
      setIsEscalationDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : 'Failed to resume escalated step.',
      );
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () => dashboardApi.cancelTask(props.task.id),
    onSuccess: async () => {
      setError(null);
      setFeedback('');
      setInstructions('');
      setIsChangesDialogOpen(false);
      setIsEscalationDialogOpen(false);
      await props.onWorkItemChanged();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to cancel step.');
    },
  });

  const canApprove = state === 'awaiting_approval' || state === 'output_pending_review';
  const canRequestChanges =
    state === 'awaiting_approval' || state === 'output_pending_review' || state === 'failed';
  const canRetry = state === 'failed';
  const canResolveEscalation = state === 'escalated';
  const canCancel = state === 'failed' || state === 'escalated' || state === 'in_progress';
  const isAnyMutationPending =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    requestChangesMutation.isPending ||
    retryMutation.isPending ||
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
            {state === 'output_pending_review' ? 'Approve Output' : 'Approve Step'}
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
        {canRetry ? (
          <Button size="sm" variant="outline" onClick={() => retryMutation.mutate()} disabled={isAnyMutationPending}>
            Retry Step
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
        <Badge variant="outline">{props.children.length} items</Badge>
      </div>
      <p className={mutedBodyClass}>
        Child work items inherit this milestone’s operator context but can move independently across the board.
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
              <span className="text-sm text-muted">{children.length} child items</span>
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
        <Badge variant="outline">{props.artifacts.length} previewable outputs</Badge>
      </div>
      {props.artifacts.map((artifact) => (
        <article
          key={artifact.id}
          className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <strong>{artifact.logical_path}</strong>
            <Badge variant="outline">{artifact.content_type}</Badge>
          </div>
          <div className={metaRowClass}>
            <Badge variant="outline">{artifact.task_title}</Badge>
            <Badge variant="outline">{artifact.size_bytes} bytes</Badge>
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

function DetailStatCard(props: {
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

function TaskOperatorPosturePanel(props: {
  task: DashboardWorkItemTaskRecord;
}): JSX.Element {
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
