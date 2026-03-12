import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import {
  dashboardApi,
  type DashboardEventRecord,
  type DashboardWorkItemMemoryEntry,
  type DashboardWorkItemMemoryHistoryEntry,
  type DashboardWorkflowBoardColumn,
  type DashboardWorkflowStageRecord,
  type DashboardWorkflowWorkItemRecord,
} from '../lib/api.js';
import { buildArtifactPermalink } from '../components/artifact-preview-support.js';
import { StructuredRecordView } from '../components/structured-data.js';
import { Badge } from '../components/ui/badge.js';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';
import {
  buildWorkItemBreadcrumbs,
  flattenArtifactsByTask,
  findWorkItemById,
  isMilestoneWorkItem,
  summarizeMilestoneOperatorFlow,
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
  tasks: DashboardWorkItemTaskRecord[];
  onSelectWorkItem(workItemId: string): void;
  onWorkItemChanged(): Promise<unknown> | unknown;
  onClearSelection(): void;
}

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
  const [childTitle, setChildTitle] = useState('');
  const [childGoal, setChildGoal] = useState('');
  const [operatorMessage, setOperatorMessage] = useState<string | null>(null);
  const [operatorError, setOperatorError] = useState<string | null>(null);

  useEffect(() => {
    const source = boardWorkItem ?? workItem;
    setStageName(source?.stage_name ?? '');
    setColumnId(source?.column_id ?? '');
    setOwnerRole(source?.owner_role ?? '');
    setParentWorkItemId(source?.parent_work_item_id ?? '');
    setOperatorMessage(null);
    setOperatorError(null);
    setChildTitle('');
    setChildGoal('');
  }, [boardWorkItem, workItem, props.workItemId]);

  const updateWorkItemMutation = useMutation({
    mutationFn: async () =>
      dashboardApi.updateWorkflowWorkItem(props.workflowId, props.workItemId, {
        stage_name: stageName || undefined,
        column_id: columnId || undefined,
        owner_role: isMilestoneWorkItem(boardWorkItem) ? null : ownerRole.trim() || null,
        parent_work_item_id:
          isMilestoneWorkItem(boardWorkItem) || parentWorkItemId.length === 0
            ? null
            : parentWorkItemId,
      }),
    onSuccess: async () => {
      setOperatorError(null);
      setOperatorMessage('Saved work item operator changes.');
      await props.onWorkItemChanged();
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
        stage_name: stageName || undefined,
        column_id: columnId || undefined,
      });
    },
    onSuccess: async (created) => {
      setOperatorError(null);
      setOperatorMessage('Created child work item.');
      setChildTitle('');
      setChildGoal('');
      await props.onWorkItemChanged();
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
  const hasOperatorChanges =
    (boardWorkItem?.stage_name ?? workItem?.stage_name ?? '') !== stageName ||
    (boardWorkItem?.column_id ?? workItem?.column_id ?? '') !== columnId ||
    (boardWorkItem?.owner_role ?? workItem?.owner_role ?? '') !== ownerRole ||
    ((canEditParent ? boardWorkItem?.parent_work_item_id ?? workItem?.parent_work_item_id ?? '' : '') !==
      (canEditParent ? parentWorkItemId : ''));

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div className="grid" style={{ gap: '0.5rem' }}>
          <div className="row">
            <h3 style={{ margin: 0 }}>Work Item Detail</h3>
            <Badge variant="outline">{props.tasks.length} linked steps</Badge>
            {artifactQuery.data ? <Badge variant="outline">{artifactQuery.data.length} artifacts</Badge> : null}
          </div>
          <p className="muted">
            Operator view of the selected work item, including linked execution steps, artifacts,
            event history, and scoped memory.
          </p>
        </div>
        <button type="button" className="button" onClick={props.onClearSelection}>
          Clear Selection
        </button>
      </div>

      {workItemQuery.isLoading ? <p>Loading work item...</p> : null}
      {workItemQuery.error ? (
        <p style={{ color: '#dc2626' }}>Failed to load work item detail.</p>
      ) : null}
      {workItem ? (
        <WorkItemHeader
          workItem={boardWorkItem ?? workItem}
          breadcrumbs={workItemBreadcrumbs}
          childCount={milestoneChildren.length}
          onSelectWorkItem={props.onSelectWorkItem}
        />
      ) : null}

      {milestoneOperatorSummary ? (
        <MilestoneOperatorSummarySection summary={milestoneOperatorSummary} />
      ) : null}

      {workItem ? (
        <WorkItemOperatorSection
          isMilestone={isMilestoneWorkItem(boardWorkItem)}
          columns={props.columns}
          stages={props.stages}
          parentMilestones={parentMilestones}
          stageName={stageName}
          columnId={columnId}
          ownerRole={ownerRole}
          parentWorkItemId={parentWorkItemId}
          childTitle={childTitle}
          childGoal={childGoal}
          onStageNameChange={setStageName}
          onColumnIdChange={setColumnId}
          onOwnerRoleChange={setOwnerRole}
          onParentWorkItemIdChange={setParentWorkItemId}
          onChildTitleChange={setChildTitle}
          onChildGoalChange={setChildGoal}
          onSave={() => updateWorkItemMutation.mutate()}
          onCreateChild={() => createChildMutation.mutate()}
          isSaving={updateWorkItemMutation.isPending}
          isCreatingChild={createChildMutation.isPending}
          hasChanges={hasOperatorChanges}
          message={operatorMessage}
          error={operatorError}
        />
      ) : null}

      <Tabs defaultValue="steps" className="grid" data-testid="work-item-detail-tabs">
        <TabsList>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="history">Event History</TabsTrigger>
        </TabsList>

        <TabsContent value="steps" className="grid">
          <WorkItemTasksSection
            workflowId={props.workflowId}
            tasks={props.tasks}
            isMilestone={isMilestoneWorkItem(boardWorkItem)}
            childCount={milestoneChildren.length}
            onWorkItemChanged={props.onWorkItemChanged}
          />
        </TabsContent>

        <TabsContent value="memory" className="grid">
          <WorkItemMemorySection
            isLoading={memoryQuery.isLoading}
            hasError={Boolean(memoryQuery.error)}
            entries={memoryEntries}
            history={memoryHistory}
            isHistoryLoading={memoryHistoryQuery.isLoading}
            hasHistoryError={Boolean(memoryHistoryQuery.error)}
          />
        </TabsContent>

        <TabsContent value="artifacts" className="grid">
          <WorkItemArtifactsSection
            isLoading={artifactQuery.isLoading}
            hasError={Boolean(artifactQuery.error)}
            tasks={props.tasks}
            artifacts={artifactQuery.data ?? []}
          />
        </TabsContent>

        <TabsContent value="history" className="grid">
          <WorkItemEventHistorySection
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
    </div>
  );
}

function WorkItemOperatorSection(props: {
  isMilestone: boolean;
  columns: DashboardWorkflowBoardColumn[];
  stages: DashboardWorkflowStageRecord[];
  parentMilestones: DashboardGroupedWorkItemRecord[];
  stageName: string;
  columnId: string;
  ownerRole: string;
  parentWorkItemId: string;
  childTitle: string;
  childGoal: string;
  onStageNameChange(value: string): void;
  onColumnIdChange(value: string): void;
  onOwnerRoleChange(value: string): void;
  onParentWorkItemIdChange(value: string): void;
  onChildTitleChange(value: string): void;
  onChildGoalChange(value: string): void;
  onSave(): void;
  onCreateChild(): void;
  isSaving: boolean;
  isCreatingChild: boolean;
  hasChanges: boolean;
  message: string | null;
  error: string | null;
}): JSX.Element {
  return (
    <div className="grid" style={{ gap: '0.75rem', marginTop: '0.75rem' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Operator Flow Controls</strong>
        {props.isMilestone ? (
          <Badge variant="outline">Milestone operator mode</Badge>
        ) : (
          <Badge variant="outline">Child/top-level operator mode</Badge>
        )}
      </div>
      <p className="muted">
        Adjust board placement, stage ownership, and milestone nesting without leaving the work-item operator view.
      </p>
      <div className="grid md:grid-cols-2" style={{ gap: '0.75rem' }}>
        <label className="grid" style={{ gap: '0.35rem' }}>
          <span>Stage</span>
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
        <label className="grid" style={{ gap: '0.35rem' }}>
          <span>Board column</span>
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
        {!props.isMilestone ? (
          <label className="grid" style={{ gap: '0.35rem' }}>
            <span>Reparent under milestone</span>
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
          <div className="rounded-md border bg-border/10 p-3 text-sm text-muted">
            Parent milestones stay top-level. Move or reparent child work items instead of nesting milestones.
          </div>
        )}
        <label className="grid" style={{ gap: '0.35rem' }}>
          <span>{props.isMilestone ? 'Owner role' : 'Owner role override'}</span>
          <Input
            value={props.ownerRole}
            onChange={(event) => props.onOwnerRoleChange(event.target.value)}
            placeholder={props.isMilestone ? 'Leave empty for milestones' : 'e.g. developer'}
          />
        </label>
      </div>
      {props.error ? <p style={{ color: '#dc2626' }}>{props.error}</p> : null}
      {props.message ? <p className="muted">{props.message}</p> : null}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={props.onSave} disabled={!props.hasChanges || props.isSaving}>
          {props.isSaving ? 'Saving…' : 'Save Operator Changes'}
        </Button>
      </div>
      {props.isMilestone ? (
        <div className="grid" style={{ gap: '0.75rem' }}>
          <strong>Create child work item</strong>
          <p className="muted">
            Break this milestone into child deliverables so operators can track each downstream work item separately.
          </p>
          <label className="grid" style={{ gap: '0.35rem' }}>
            <span>Title</span>
            <Input
              value={props.childTitle}
              onChange={(event) => props.onChildTitleChange(event.target.value)}
              placeholder="e.g. Implement auth service"
            />
          </label>
          <label className="grid" style={{ gap: '0.35rem' }}>
            <span>Goal</span>
            <Input
              value={props.childGoal}
              onChange={(event) => props.onChildGoalChange(event.target.value)}
              placeholder="Describe the child deliverable."
            />
          </label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button
              onClick={props.onCreateChild}
              disabled={props.childTitle.trim().length === 0 || props.isCreatingChild}
            >
              {props.isCreatingChild ? 'Creating…' : 'Create Child Work Item'}
            </Button>
          </div>
        </div>
      ) : null}
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
    return <p>Loading work-item memory...</p>;
  }
  if (props.hasError) {
    return <p style={{ color: '#dc2626' }}>Failed to load work-item memory.</p>;
  }

  return (
    <div className="grid" style={{ gap: '1rem' }}>
      <div className="grid" style={{ gap: '0.75rem' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>Current memory</strong>
          <Badge variant="outline">{props.entries.length} entries</Badge>
        </div>
        {props.entries.length === 0 ? (
          <p className="muted">No work-item memory entries recorded yet.</p>
        ) : (
          props.entries.map((entry) => (
            <article key={`${entry.key}:${entry.event_id}`} className="card timeline-entry">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{entry.key}</strong>
                <Badge variant="outline">{entry.stage_name ?? 'work item scope'}</Badge>
              </div>
              <div className="row">
                <Badge variant="outline">{entry.actor_type}</Badge>
                {entry.task_id ? <Badge variant="outline">task {entry.task_id}</Badge> : null}
                <span className="muted">{formatTimestamp(entry.updated_at)}</span>
              </div>
              <StructuredRecordView data={entry.value} emptyMessage="No memory payload." />
            </article>
          ))
        )}
      </div>

      <div className="grid" style={{ gap: '0.75rem' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>Memory history</strong>
          <Badge variant="outline">{props.history.length} events</Badge>
        </div>
        {props.isHistoryLoading ? <p>Loading memory history...</p> : null}
        {props.hasHistoryError ? (
          <p style={{ color: '#dc2626' }}>Failed to load work-item memory history.</p>
        ) : null}
        {!props.isHistoryLoading && !props.hasHistoryError && props.history.length === 0 ? (
          <p className="muted">No work-item memory history recorded yet.</p>
        ) : null}
        {!props.isHistoryLoading && !props.hasHistoryError
          ? props.history.map((entry) => (
              <article key={`history:${entry.event_id}`} className="card timeline-entry">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{entry.key}</strong>
                  <Badge variant={entry.event_type === 'deleted' ? 'secondary' : 'outline'}>
                    {entry.event_type}
                  </Badge>
                </div>
                <div className="row">
                  <Badge variant="outline">{entry.actor_type}</Badge>
                  {entry.stage_name ? <Badge variant="outline">{entry.stage_name}</Badge> : null}
                  {entry.task_id ? <Badge variant="outline">task {entry.task_id}</Badge> : null}
                  <span className="muted">{formatTimestamp(entry.updated_at)}</span>
                </div>
                <StructuredRecordView data={entry.value} emptyMessage="No memory payload." />
              </article>
            ))
          : null}
      </div>
    </div>
  );
}

function WorkItemHeader(props: {
  workItem: DashboardGroupedWorkItemRecord;
  breadcrumbs: string[];
  childCount: number;
  onSelectWorkItem(workItemId: string): void;
}): JSX.Element {
  const { workItem } = props;
  const milestone = isMilestoneWorkItem(workItem);
  const completedChildren = workItem.children_completed ?? workItem.children?.filter((child) => child.completed_at).length ?? 0;
  return (
    <div className="grid" style={{ gap: '0.75rem', marginTop: '0.75rem' }}>
      <div className="row">
        <Badge variant="outline">Operator breadcrumb</Badge>
        <span className="muted">
          {(props.breadcrumbs.length > 0 ? props.breadcrumbs : [workItem.title]).join(' / ')}
          {workItem.stage_name ? ` / ${workItem.stage_name}` : ''}
        </span>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="grid" style={{ gap: '0.5rem' }}>
          <strong>{workItem.title}</strong>
          {workItem.goal ? <p className="muted">{workItem.goal}</p> : null}
        </div>
        <div className="row">
          <Badge variant="outline">{workItem.stage_name}</Badge>
          <Badge variant="outline">{workItem.priority}</Badge>
          <Badge variant="outline">{workItem.column_id}</Badge>
          {milestone ? <Badge variant="outline">Milestone</Badge> : null}
          {milestone ? (
            <Badge variant="outline">
              {completedChildren}/{props.childCount} children complete
            </Badge>
          ) : null}
          {workItem.completed_at ? <Badge variant="secondary">completed</Badge> : null}
        </div>
      </div>
      <div className="row">
        {workItem.owner_role ? <Badge variant="outline">{workItem.owner_role}</Badge> : null}
        {workItem.task_count !== undefined ? (
          <Badge variant="outline">{workItem.task_count} linked steps</Badge>
        ) : null}
        {workItem.parent_work_item_id ? (
          <button
            type="button"
            className="status-badge"
            onClick={() => props.onSelectWorkItem(workItem.parent_work_item_id as string)}
          >
            Open parent milestone
          </button>
        ) : null}
      </div>
      {workItem.acceptance_criteria ? (
        <div className="rounded-md border bg-border/10 p-3 text-sm">
          <strong>Acceptance criteria</strong>
          <p className="muted" style={{ marginTop: '0.35rem' }}>
            {workItem.acceptance_criteria}
          </p>
        </div>
      ) : null}
      {workItem.notes ? (
        <div className="rounded-md border bg-border/10 p-3 text-sm">
          <strong>Notes</strong>
          <p className="muted" style={{ marginTop: '0.35rem' }}>
            {workItem.notes}
          </p>
        </div>
      ) : null}
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
    <div className="grid md:grid-cols-3" style={{ gap: '0.75rem', marginTop: '0.75rem' }}>
      <article className="rounded-md border bg-border/10 p-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Milestone group summary
        </div>
        <div className="row">
          <Badge variant="outline">{props.summary.totalChildren} child items</Badge>
          <Badge variant="outline">{props.summary.completedChildren} complete</Badge>
          <Badge variant="outline">{props.summary.openChildren} open</Badge>
        </div>
      </article>
      <article className="rounded-md border bg-border/10 p-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Operator attention
        </div>
        <div className="row">
          <Badge variant="warning">{props.summary.awaitingStepReviews} step reviews</Badge>
          <Badge variant="destructive">{props.summary.failedSteps} failed steps</Badge>
          <Badge variant="outline">{props.summary.inFlightSteps} in flight</Badge>
        </div>
      </article>
      <article className="rounded-md border bg-border/10 p-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Active footprint
        </div>
        <div className="row">
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
    </div>
  );
}

function WorkItemTasksSection(props: {
  workflowId: string;
  tasks: DashboardWorkItemTaskRecord[];
  isMilestone: boolean;
  childCount: number;
  onWorkItemChanged(): Promise<unknown> | unknown;
}): JSX.Element {
  if (props.tasks.length === 0) {
    return <p className="muted">No execution steps are linked to this work item yet.</p>;
  }

  return (
    <div className="grid" style={{ gap: '0.75rem' }}>
      {props.isMilestone ? (
        <p className="muted">
          Showing execution steps linked to this milestone and its {props.childCount} child work items.
        </p>
      ) : (
        <p className="muted">
          Linked execution steps stay here so approvals, rework, and retries remain anchored to the selected work item.
        </p>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>Step</th>
            <th>State</th>
            <th>Role</th>
            <th>Stage</th>
            <th>Dependencies</th>
            <th>Operator flow</th>
          </tr>
        </thead>
        <tbody>
          {props.tasks.map((task) => (
            <tr key={task.id}>
              <td>
                <Link to={`/work/tasks/${task.id}`}>{task.title}</Link>
              </td>
              <td>
                <span className={`status-badge status-${task.state}`}>{task.state}</span>
              </td>
              <td>{task.role ?? 'Unassigned'}</td>
              <td>{task.stage_name ?? 'unassigned'}</td>
              <td>{task.depends_on.length > 0 ? task.depends_on.join(', ') : '—'}</td>
              <td>
                <WorkItemTaskActionCell
                  workflowId={props.workflowId}
                  task={task}
                  onWorkItemChanged={props.onWorkItemChanged}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WorkItemTaskActionCell(props: {
  workflowId: string;
  task: DashboardWorkItemTaskRecord;
  onWorkItemChanged(): Promise<unknown> | unknown;
}): JSX.Element {
  const [isChangesDialogOpen, setIsChangesDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const state = props.task.state;
  const workItemPermalink = props.task.work_item_id
    ? `/work/workflows/${props.workflowId}?work_item=${encodeURIComponent(props.task.work_item_id)}#work-item-${encodeURIComponent(props.task.work_item_id)}`
    : null;

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

  const canApprove = state === 'awaiting_approval' || state === 'output_pending_review';
  const canRequestChanges =
    state === 'awaiting_approval' || state === 'output_pending_review' || state === 'failed';
  const canRetry = state === 'failed';

  return (
    <div className="grid" style={{ gap: '0.35rem' }}>
      <div className="row">
        <Link to={`/work/tasks/${props.task.id}`}>Open step record</Link>
        {workItemPermalink ? <Link to={workItemPermalink}>Focus work item</Link> : null}
      </div>
      <div className="row">
        {canApprove ? (
          <Button
            size="sm"
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending || rejectMutation.isPending || requestChangesMutation.isPending}
          >
            {state === 'output_pending_review' ? 'Approve Output' : 'Approve Step'}
          </Button>
        ) : null}
        {canRequestChanges ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsChangesDialogOpen(true)}
            disabled={approveMutation.isPending || rejectMutation.isPending || requestChangesMutation.isPending}
          >
            Request Changes
          </Button>
        ) : null}
        {canRetry ? (
          <Button size="sm" variant="outline" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>
            Retry Step
          </Button>
        ) : null}
      </div>
      {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
      {isChangesDialogOpen ? (
        <div className="grid" style={{ gap: '0.35rem' }}>
          <Textarea
            value={feedback}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
              setFeedback(event.target.value)
            }
            placeholder="Describe the operator changes needed..."
            rows={3}
          />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="outline" onClick={() => setIsChangesDialogOpen(false)}>
              Cancel
            </Button>
            {state === 'failed' ? (
              <Button
                onClick={() => requestChangesMutation.mutate()}
                disabled={!feedback.trim() || requestChangesMutation.isPending}
              >
                Rework Step
              </Button>
            ) : (
              <>
                <Button
                  variant="destructive"
                  onClick={() => rejectMutation.mutate()}
                  disabled={!feedback.trim() || rejectMutation.isPending}
                >
                  Reject Step
                </Button>
                <Button
                  onClick={() => requestChangesMutation.mutate()}
                  disabled={!feedback.trim() || requestChangesMutation.isPending}
                >
                  Request Changes
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
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
    <div className="grid" style={{ gap: '0.75rem', marginTop: '1rem' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Milestone children</strong>
        <Badge variant="outline">{props.children.length} items</Badge>
      </div>
      <p className="muted">
        Child work items inherit this milestone’s operator context but can move independently across the board.
      </p>
      {props.children.length === 0 ? (
        <p className="muted">No child work items are linked to this milestone yet.</p>
      ) : (
        Object.entries(groupedByStage).map(([stageName, children]) => (
          <div key={stageName} className="grid" style={{ gap: '0.5rem' }}>
            <div className="row">
              <Badge variant="outline">Stage group</Badge>
              <strong>{stageName}</strong>
              <span className="muted">{children.length} child items</span>
            </div>
            {children.map((child) => (
              <article key={child.id} className="card timeline-entry">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <button type="button" className="text-left" onClick={() => props.onSelectWorkItem(child.id)}>
                    <strong>{child.title}</strong>
                  </button>
                  <div className="row">
                    <Badge variant="outline">{child.column_id}</Badge>
                    {child.completed_at ? <Badge variant="secondary">completed</Badge> : null}
                  </div>
                </div>
                <div className="row">
                  <Badge variant="outline">Open child work-item flow</Badge>
                </div>
                {child.goal ? <p className="muted">{child.goal}</p> : null}
              </article>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function WorkItemArtifactsSection(props: {
  isLoading: boolean;
  hasError: boolean;
  tasks: DashboardWorkItemTaskRecord[];
  artifacts: DashboardWorkItemArtifactRecord[];
}): JSX.Element {
  if (props.isLoading) {
    return <p>Loading work-item artifacts...</p>;
  }
  if (props.hasError) {
    return <p style={{ color: '#dc2626' }}>Failed to load work-item artifacts.</p>;
  }
  if (props.tasks.length === 0) {
    return <p className="muted">Artifacts appear after linked steps upload them.</p>;
  }
  if (props.artifacts.length === 0) {
    return <p className="muted">No artifacts recorded for this work item yet.</p>;
  }

  return (
    <div className="grid">
      {props.artifacts.map((artifact) => (
        <article key={artifact.id} className="card timeline-entry">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{artifact.logical_path}</strong>
            <Badge variant="outline">{artifact.content_type}</Badge>
          </div>
          <div className="row">
            <Badge variant="outline">{artifact.task_title}</Badge>
            <Badge variant="outline">{artifact.size_bytes} bytes</Badge>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">{new Date(artifact.created_at).toLocaleString()}</span>
            <Link to={buildArtifactPermalink(artifact.task_id, artifact.id)}>Preview artifact</Link>
          </div>
        </article>
      ))}
    </div>
  );
}

function WorkItemEventHistorySection(props: {
  isLoading: boolean;
  hasError: boolean;
  events: DashboardEventRecord[];
}): JSX.Element {
  if (props.isLoading) {
    return <p>Loading work-item history...</p>;
  }
  if (props.hasError) {
    return <p style={{ color: '#dc2626' }}>Failed to load work-item history.</p>;
  }
  if (props.events.length === 0) {
    return <p className="muted">No work-item events recorded yet.</p>;
  }

  return (
    <ul className="search-results">
      {props.events.map((event) => (
        <li key={event.id}>
          <strong>{event.type}</strong>
          <span className="muted"> {new Date(event.created_at).toLocaleString()}</span>
          <StructuredRecordView data={event.data} emptyMessage="No event payload." />
        </li>
      ))}
    </ul>
  );
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString();
}
