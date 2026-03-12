import { StructuredRecordView } from '../components/structured-data.js';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import type {
  DashboardProjectTimelineEntry,
  DashboardWorkflowActivationRecord,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowStageRecord,
  DashboardWorkflowWorkItemRecord,
} from '../lib/api.js';
import type { DashboardWorkflowTaskRow } from './workflow-detail-support.js';
import { listWorkflowGates, type DashboardGateDetailRecord } from './work/gate-api.js';
import { GateDetailCard } from './work/gate-detail-card.js';
import {
  buildWorkflowDetailPermalink,
  isWorkflowDetailTargetHighlighted,
} from './workflow-detail-permalinks.js';
import {
  groupWorkflowWorkItems,
  type DashboardGroupedWorkItemRecord,
} from './workflow-work-item-detail-support.js';

interface MissionControlSummary {
  total: number;
  ready: number;
  in_progress: number;
  blocked: number;
  completed: number;
  failed: number;
}

export function MissionControlCard(props: {
  summary: MissionControlSummary;
  totalCostUsd: number;
  onPause(): void;
  onResume(): void;
  onCancel(): void;
}) {
  return (
    <div className="card">
      <h3>Mission Control</h3>
      <p className="muted">Operator controls and live workflow health for this workflow.</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="button" onClick={props.onPause}>Pause</button>
        <button type="button" className="button" onClick={props.onResume}>Resume</button>
        <button type="button" className="button" onClick={props.onCancel}>Cancel</button>
      </div>
      <div className="row mission-grid">
        <MissionMetric label="Total" value={props.summary.total} />
        <MissionMetric label="Ready" value={props.summary.ready} />
        <MissionMetric label="In Progress" value={props.summary.in_progress} />
        <MissionMetric label="Blocked" value={props.summary.blocked} />
        <MissionMetric label="Completed" value={props.summary.completed} />
        <MissionMetric label="Failed" value={props.summary.failed} />
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">Stage changes, retries, and approvals should flow through work items and gates.</span>
        <strong>${props.totalCostUsd.toFixed(4)}</strong>
      </div>
    </div>
  );
}

export function TaskGraphCard(props: {
  tasks: DashboardWorkflowTaskRow[];
  stageGroups: Array<{ stageName: string; tasks: DashboardWorkflowTaskRow[] }>;
  isLoading: boolean;
  hasError: boolean;
}) {
  return (
    <div className="card">
      <h3>Task Graph</h3>
      <p className="muted">Dependency graph grouped by workflow stage for faster operator scanning.</p>
      {props.isLoading ? <p>Loading tasks...</p> : null}
      {props.hasError ? <p style={{ color: '#dc2626' }}>Failed to load tasks</p> : null}
      <div className="grid">
        {props.stageGroups.map((group) => (
          <div key={group.stageName} className="card timeline-entry">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{group.stageName}</strong>
              <span className="status-badge">{group.tasks.length} tasks</span>
            </div>
            <table className="table">
              <thead>
                <tr><th>Task</th><th>State</th><th>Depends On</th></tr>
              </thead>
              <tbody>
                {group.tasks.map((task) => (
                  <tr key={task.id}>
                    <td><Link to={`/work/tasks/${task.id}`}>{task.title}</Link></td>
                    <td><span className={`status-badge status-${task.state}`}>{task.state}</span></td>
                    <td>{task.depends_on.length > 0 ? task.depends_on.join(', ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlaybookBoardCard(props: {
  board?: DashboardWorkflowBoardResponse;
  isLoading: boolean;
  hasError: boolean;
  selectedWorkItemId?: string | null;
  onSelectWorkItem?(workItemId: string): void;
}) {
  const location = useLocation();
  const groupedWorkItems = groupWorkflowWorkItems(props.board?.work_items ?? []);
  const workItemsById = new Map((props.board?.work_items ?? []).map((item) => [item.id, item]));
  const milestoneGroups = groupedWorkItems.filter((item) => (item.children?.length ?? 0) > 0);

  return (
    <div className="card">
      <h3>Workflow Board</h3>
      <p className="muted">Live work items grouped by playbook board column with milestone grouping and stage-level load at a glance.</p>
      {props.isLoading ? <p>Loading board...</p> : null}
      {props.hasError ? <p style={{ color: '#dc2626' }}>Failed to load workflow board.</p> : null}
      {props.board ? (
        <div className="grid gap-4">
          {milestoneGroups.length > 0 ? (
            <div className="grid gap-3">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>Milestone groups</strong>
                <span className="muted">Grouped by milestone for parent-child orchestration visibility.</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {milestoneGroups.map((milestone) => (
                  <MilestoneGroupCard
                    key={milestone.id}
                    milestone={milestone}
                    selectedWorkItemId={props.selectedWorkItemId}
                    onSelectWorkItem={props.onSelectWorkItem}
                  />
                ))}
              </div>
            </div>
          ) : null}
          {props.board.stage_summary.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-3">
              {props.board.stage_summary.map((stage) => (
                <article key={stage.name} className="rounded-md border bg-border/10 p-4">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong>{stage.name}</strong>
                    <span className="status-badge">
                      {stage.completed_count}/{stage.work_item_count}
                    </span>
                  </div>
                  <p className="muted">{stage.goal}</p>
                </article>
              ))}
            </div>
          ) : null}
          <div className="workflow-lane-grid">
            {props.board.columns.map((column) => {
              const items =
                props.board?.work_items.filter((item) => item.column_id === column.id) ?? [];
              return (
                <article key={column.id} className="card workflow-lane">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong>{column.label}</strong>
                    <span className="status-badge">{items.length}</span>
                  </div>
                  {column.description ? <p className="muted">{column.description}</p> : null}
                  <div className="grid">
                    {items.map((item) => (
                      <article
                        key={item.id}
                        id={`work-item-${item.id}`}
                        className="card workflow-item-card"
                        data-selected={props.selectedWorkItemId === item.id ? 'true' : 'false'}
                      >
                        <div className="row" style={{ justifyContent: 'space-between' }}>
                          <button
                            type="button"
                            className="text-left"
                            aria-pressed={props.selectedWorkItemId === item.id}
                            onClick={() => props.onSelectWorkItem?.(item.id)}
                          >
                            <strong>{item.title}</strong>
                          </button>
                          <div className="row">
                            {item.completed_at ? (
                              <span className="status-badge status-completed">completed</span>
                            ) : null}
                            <Link
                              to={buildWorkflowDetailPermalink(item.workflow_id, {
                                workItemId: item.id,
                              })}
                              className="muted"
                            >
                              Permalink
                            </Link>
                          </div>
                        </div>
                        <div className="row" style={{ justifyContent: 'space-between' }}>
                          <span className="status-badge">
                            {isWorkflowDetailTargetHighlighted(
                              location.search,
                              location.hash,
                              'work_item',
                              item.id,
                            )
                              ? 'Highlighted'
                              : item.stage_name}
                          </span>
                        </div>
                        <div className="row">
                          <span className="status-badge">{item.priority}</span>
                          {item.owner_role ? (
                            <span className="status-badge">{item.owner_role}</span>
                          ) : null}
                          {isMilestoneRecord(item) ? (
                            <span className="status-badge">Milestone</span>
                          ) : null}
                          {item.parent_work_item_id && workItemsById.get(item.parent_work_item_id) ? (
                            <span className="status-badge">
                              Milestone: {workItemsById.get(item.parent_work_item_id)?.title}
                            </span>
                          ) : null}
                          {item.task_count !== undefined ? (
                            <span className="status-badge">{item.task_count} tasks</span>
                          ) : null}
                          {isMilestoneRecord(item) ? (
                            <span className="status-badge">
                              {readCompletedChildren(item)}/{readChildCount(item)} children
                            </span>
                          ) : null}
                        </div>
                        {item.goal ? <p className="muted">{item.goal}</p> : null}
                        {item.acceptance_criteria ? (
                          <p className="muted">
                            Acceptance: {item.acceptance_criteria}
                          </p>
                        ) : null}
                        {item.notes ? <p className="muted">Notes: {item.notes}</p> : null}
                      </article>
                    ))}
                    {items.length === 0 ? <p className="muted">No work items.</p> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MilestoneGroupCard(props: {
  milestone: DashboardGroupedWorkItemRecord;
  selectedWorkItemId?: string | null;
  onSelectWorkItem?(workItemId: string): void;
}) {
  const completedChildren = readCompletedChildren(props.milestone);
  const totalChildren = readChildCount(props.milestone);
  const progressPercent = totalChildren === 0 ? 0 : Math.round((completedChildren / totalChildren) * 100);

  return (
    <article className="card timeline-entry">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button
          type="button"
          className="text-left"
          aria-pressed={props.selectedWorkItemId === props.milestone.id}
          onClick={() => props.onSelectWorkItem?.(props.milestone.id)}
        >
          <strong>{props.milestone.title}</strong>
        </button>
        <div className="row">
          <span className="status-badge">Milestone</span>
          <span className="status-badge">{progressPercent}% complete</span>
        </div>
      </div>
      {props.milestone.goal ? <p className="muted">{props.milestone.goal}</p> : null}
      <div className="row">
        <span className="status-badge">
          {completedChildren}/{totalChildren} child items complete
        </span>
        <span className="status-badge">{props.milestone.stage_name}</span>
        <span className="status-badge">{props.milestone.column_id}</span>
      </div>
      <div className="grid gap-2">
        {(props.milestone.children ?? []).map((child) => (
          <article key={child.id} className="rounded-md border bg-border/10 p-3">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="text-left"
                aria-pressed={props.selectedWorkItemId === child.id}
                onClick={() => props.onSelectWorkItem?.(child.id)}
              >
                <strong>{child.title}</strong>
              </button>
              <div className="row">
                <span className="status-badge">{child.column_id}</span>
                <span className="status-badge">{child.stage_name}</span>
                {child.completed_at ? (
                  <span className="status-badge status-completed">completed</span>
                ) : null}
              </div>
            </div>
            {child.goal ? <p className="muted">{child.goal}</p> : null}
          </article>
        ))}
      </div>
    </article>
  );
}

function isMilestoneRecord(
  item: { children_count?: number; is_milestone?: boolean } | DashboardWorkflowWorkItemRecord,
) {
  return (item.children_count ?? 0) > 0 || item.is_milestone === true;
}

function readChildCount(
  item:
    | { children_count?: number; children?: DashboardGroupedWorkItemRecord[] }
    | DashboardWorkflowWorkItemRecord,
) {
  return item.children_count ?? item.children?.length ?? 0;
}

function readCompletedChildren(item: {
  children_completed?: number;
  children?: DashboardGroupedWorkItemRecord[];
} | DashboardWorkflowWorkItemRecord) {
  return item.children_completed ?? item.children?.filter((child) => child.completed_at).length ?? 0;
}

export function WorkflowStagesCard(props: {
  stages: DashboardWorkflowStageRecord[];
  isLoading: boolean;
  hasError: boolean;
  selectedGateStageName?: string | null;
  onSelectGate?(stageName: string): void;
}) {
  const location = useLocation();
  const params = useParams<{ id: string }>();
  const workflowId = params.id ?? '';
  const gatesQuery = useQuery({
    queryKey: ['workflow-gates', workflowId],
    queryFn: () => listWorkflowGates(workflowId),
    enabled: workflowId.length > 0,
  });
  const gatesByStageName = new Map<string, DashboardGateDetailRecord>();
  for (const gate of gatesQuery.data ?? []) {
    if (!gatesByStageName.has(gate.stage_name)) {
      gatesByStageName.set(gate.stage_name, gate);
    }
  }

  return (
    <div className="card">
      <h3>Workflow Stages</h3>
      <p className="muted">Stage goals, gate detail, and stable gate permalinks for this playbook workflow.</p>
      {props.isLoading ? <p>Loading stages...</p> : null}
      {props.hasError ? <p style={{ color: '#dc2626' }}>Failed to load workflow stages.</p> : null}
      {gatesQuery.isError ? <p style={{ color: '#dc2626' }}>Failed to load workflow gate detail.</p> : null}
      <div className="grid">
        {props.stages.map((stage) => (
          <article
            key={stage.id}
            id={`gate-${stage.name}`}
            className="card timeline-entry"
            data-highlighted={
              props.selectedGateStageName === stage.name ||
              isWorkflowDetailTargetHighlighted(location.search, location.hash, 'gate', stage.name)
                ? 'true'
                : 'false'
            }
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{stage.position + 1}. {stage.name}</strong>
              <div className="row">
                <span className={`status-badge status-${stage.status}`}>{stage.status}</span>
                <span className="status-badge">Gate: {stage.gate_status}</span>
              </div>
            </div>
            <p className="muted">{stage.goal}</p>
            {stage.guidance ? <p className="muted">{stage.guidance}</p> : null}
            <div className="row">
              <span className="status-badge">Iterations: {stage.iteration_count}</span>
              {stage.human_gate ? <span className="status-badge">Human Gate</span> : null}
              {stage.started_at ? (
                <span className="status-badge">
                  Started {new Date(stage.started_at).toLocaleDateString()}
                </span>
              ) : null}
              <button
                type="button"
                className="status-badge"
                onClick={() => props.onSelectGate?.(stage.name)}
              >
                Gate focus
              </button>
              <Link
                to={buildWorkflowDetailPermalink(workflowId, {
                  gateStageName: stage.name,
                })}
                className="muted"
              >
                Permalink
              </Link>
            </div>
            {stage.summary ? (
              <div className="rounded-md border bg-border/10 p-3 text-xs text-muted">
                {stage.summary}
              </div>
            ) : null}
            {gatesByStageName.get(stage.name) ? (
              <div className="pt-2">
                <GateDetailCard gate={gatesByStageName.get(stage.name) as DashboardGateDetailRecord} source="workflow-detail" />
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

export function WorkflowActivationsCard(props: {
  activations: DashboardWorkflowActivationRecord[];
  isLoading: boolean;
  hasError: boolean;
  selectedActivationId?: string | null;
  onSelectActivation?(activationId: string): void;
}) {
  const location = useLocation();

  return (
    <div className="card">
      <h3>Activation Queue</h3>
      <p className="muted">Queued and completed orchestrator activations for this workflow.</p>
      {props.isLoading ? <p>Loading activations...</p> : null}
      {props.hasError ? <p style={{ color: '#dc2626' }}>Failed to load activations.</p> : null}
      <div className="grid">
        {props.activations.map((activation) => (
          <article
            key={activation.id}
            id={`activation-${activation.activation_id ?? activation.id}`}
            className="card timeline-entry"
            data-highlighted={
              props.selectedActivationId === (activation.activation_id ?? activation.id) ||
              isWorkflowDetailTargetHighlighted(
                location.search,
                location.hash,
                'activation',
                activation.activation_id ?? activation.id,
              )
                ? 'true'
                : 'false'
            }
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{activation.event_type}</strong>
              <span className={`status-badge status-${activation.state}`}>{activation.state}</span>
            </div>
            <p className="muted">{activation.reason}</p>
            <p className="muted">Queued: {new Date(activation.queued_at).toLocaleString()}</p>
            <div className="row">
              <button
                type="button"
                className="status-badge"
                onClick={() =>
                  props.onSelectActivation?.(activation.activation_id ?? activation.id)
                }
              >
                Activation {activation.activation_id ?? activation.id}
              </button>
              <span className="status-badge">
                {activation.event_count ?? activation.events?.length ?? 1} events
              </span>
              <Link
                to={buildWorkflowDetailPermalink(activation.workflow_id, {
                  activationId: activation.activation_id ?? activation.id,
                })}
                className="muted"
              >
                Permalink
              </Link>
            </div>
            <StructuredRecordView data={activation.payload} emptyMessage="No activation payload." />
            {activation.events && activation.events.length > 0 ? (
              <ul className="search-results">
                {activation.events.map((event) => (
                  <li key={event.id}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong>{event.event_type}</strong>
                      <span className={`status-badge status-${event.state}`}>{event.state}</span>
                    </div>
                    <p className="muted">{event.reason}</p>
                    <p className="muted">Queued: {new Date(event.queued_at).toLocaleString()}</p>
                    <StructuredRecordView data={event.payload} emptyMessage="No activation payload." />
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
        {props.activations.length === 0 && !props.isLoading && !props.hasError ? (
          <p className="muted">No workflow activations recorded yet.</p>
        ) : null}
      </div>
    </div>
  );
}

export function WorkflowHistoryCard(props: {
  isLoading: boolean;
  hasError: boolean;
  events: Array<{ id: string; type: string; created_at: string; data?: Record<string, unknown> }>;
}) {
  return (
    <div className="card">
      <h3>Workflow History</h3>
      {props.isLoading ? <p>Loading history...</p> : null}
      {props.hasError ? <p style={{ color: '#dc2626' }}>Failed to load workflow history.</p> : null}
      <ul className="search-results">
        {props.events.map((event) => (
              <li key={event.id}>
                <strong>{event.type}</strong>
                <span className="muted"> {new Date(event.created_at).toLocaleString()}</span>
                <StructuredRecordView data={event.data} emptyMessage="No event payload." />
              </li>
            ))}
          </ul>
    </div>
  );
}

export function ProjectTimelineCard(props: {
  isLoading: boolean;
  hasError: boolean;
  entries: DashboardProjectTimelineEntry[];
  currentWorkflowId: string;
  selectedChildWorkflowId?: string | null;
  onSelectChildWorkflow?(workflowId: string): void;
}) {
  const location = useLocation();

  return (
    <div className="card">
      <h3>Project Timeline</h3>
      <p className="muted">Run-level continuity for this project, including chained lineage.</p>
      {props.isLoading ? <p>Loading timeline...</p> : null}
      {props.hasError ? <p style={{ color: '#dc2626' }}>Failed to load project timeline.</p> : null}
      <div className="grid">
        {props.entries.map((entry) => (
          <article
            key={entry.workflow_id}
            id={`child-workflow-${entry.workflow_id}`}
            className="card timeline-entry"
            data-highlighted={
              props.selectedChildWorkflowId === entry.workflow_id ||
              isWorkflowDetailTargetHighlighted(
                location.search,
                location.hash,
                'child',
                entry.workflow_id,
              )
                ? 'true'
                : 'false'
            }
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{entry.name}</strong>
              <span className={`status-badge status-${entry.state}`}>{entry.state}</span>
            </div>
            <p className="muted">{entry.completed_at ? new Date(entry.completed_at).toLocaleString() : 'In progress'}</p>
            <div className="row">
              <span className="status-badge">Duration: {entry.duration_seconds ?? 0}s</span>
              <span className="status-badge">Artifacts: {entry.produced_artifacts?.length ?? 0}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="muted"
                onClick={() => props.onSelectChildWorkflow?.(entry.workflow_id)}
              >
                Highlight lineage
              </button>
              <div className="row">
                {entry.workflow_id !== props.currentWorkflowId ? (
                  <Link to={`/work/workflows/${entry.workflow_id}`}>Open workflow</Link>
                ) : null}
                <Link
                  to={buildWorkflowDetailPermalink(props.currentWorkflowId, {
                    childWorkflowId: entry.workflow_id,
                  })}
                  className="muted"
                >
                  Permalink
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function MissionMetric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="card mission-metric">
      <p className="muted">{label}</p>
      <strong>{value}</strong>
    </div>
  );
}
