import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import {
  dashboardApi,
  type DashboardEventRecord,
  type DashboardWorkItemMemoryEntry,
  type DashboardWorkItemMemoryHistoryEntry,
  type DashboardWorkflowWorkItemRecord,
} from '../lib/api.js';
import { buildArtifactPermalink } from '../components/artifact-preview-support.js';
import { StructuredRecordView } from '../components/structured-data.js';
import { Badge } from '../components/ui/badge.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';
import {
  flattenArtifactsByTask,
  findWorkItemById,
  isMilestoneWorkItem,
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
  tasks: DashboardWorkItemTaskRecord[];
  onSelectWorkItem(workItemId: string): void;
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
  const parentWorkItem = useMemo(
    () =>
      boardWorkItem?.parent_work_item_id
        ? findWorkItemById(props.workItems, boardWorkItem.parent_work_item_id)
        : null,
    [boardWorkItem?.parent_work_item_id, props.workItems],
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

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="grid" style={{ gap: '0.5rem' }}>
          <div className="row">
            <h3 style={{ margin: 0 }}>Work Item Detail</h3>
            <Badge variant="outline">{props.tasks.length} tasks</Badge>
            {artifactQuery.data ? <Badge variant="outline">{artifactQuery.data.length} artifacts</Badge> : null}
          </div>
          <p className="muted">
            Tasks, artifacts, event history, and work-item-scoped memory for the selected work
            item.
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
          parentWorkItem={parentWorkItem}
          childCount={milestoneChildren.length}
          onSelectWorkItem={props.onSelectWorkItem}
        />
      ) : null}

      <Tabs defaultValue="tasks" className="grid" data-testid="work-item-detail-tabs">
        <TabsList>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="history">Event History</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="grid">
          <WorkItemTasksSection
            tasks={props.tasks}
            isMilestone={isMilestoneWorkItem(boardWorkItem)}
            childCount={milestoneChildren.length}
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
  parentWorkItem: DashboardGroupedWorkItemRecord | null;
  childCount: number;
  onSelectWorkItem(workItemId: string): void;
}): JSX.Element {
  const { workItem } = props;
  const milestone = isMilestoneWorkItem(workItem);
  const completedChildren = workItem.children_completed ?? workItem.children?.filter((child) => child.completed_at).length ?? 0;
  return (
    <div className="grid" style={{ gap: '0.75rem', marginTop: '0.75rem' }}>
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
          <Badge variant="outline">{workItem.task_count} linked tasks</Badge>
        ) : null}
        {props.parentWorkItem ? (
          <button
            type="button"
            className="status-badge"
            onClick={() => props.onSelectWorkItem(props.parentWorkItem!.id)}
          >
            Parent milestone: {props.parentWorkItem.title}
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

function WorkItemTasksSection(props: {
  tasks: DashboardWorkItemTaskRecord[];
  isMilestone: boolean;
  childCount: number;
}): JSX.Element {
  if (props.tasks.length === 0) {
    return <p className="muted">No tasks are linked to this work item yet.</p>;
  }

  return (
    <div className="grid" style={{ gap: '0.75rem' }}>
      {props.isMilestone ? (
        <p className="muted">
          Showing tasks linked to this milestone and its {props.childCount} child work items.
        </p>
      ) : null}
      <table className="table">
        <thead>
          <tr>
            <th>Task</th>
            <th>State</th>
            <th>Role</th>
            <th>Stage</th>
            <th>Dependencies</th>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MilestoneChildrenSection(props: {
  children: DashboardGroupedWorkItemRecord[];
  onSelectWorkItem(workItemId: string): void;
}): JSX.Element {
  return (
    <div className="grid" style={{ gap: '0.75rem', marginTop: '1rem' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Milestone children</strong>
        <Badge variant="outline">{props.children.length} items</Badge>
      </div>
      {props.children.length === 0 ? (
        <p className="muted">No child work items are linked to this milestone yet.</p>
      ) : (
        props.children.map((child) => (
          <article key={child.id} className="card timeline-entry">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="text-left" onClick={() => props.onSelectWorkItem(child.id)}>
                <strong>{child.title}</strong>
              </button>
              <div className="row">
                <Badge variant="outline">{child.stage_name}</Badge>
                <Badge variant="outline">{child.column_id}</Badge>
                {child.completed_at ? <Badge variant="secondary">completed</Badge> : null}
              </div>
            </div>
            {child.goal ? <p className="muted">{child.goal}</p> : null}
          </article>
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
    return <p className="muted">Artifacts appear after linked tasks upload them.</p>;
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
