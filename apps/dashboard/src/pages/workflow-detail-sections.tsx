import { StructuredRecordView } from '../components/structured-data.js';
import { Link } from 'react-router-dom';

import type { DashboardProjectTimelineEntry } from '../lib/api.js';
import type { DashboardWorkflowPhaseRow, DashboardWorkflowTaskRow } from './workflow-detail-support.js';

interface MissionControlSummary {
  total: number;
  ready: number;
  running: number;
  blocked: number;
  completed: number;
  failed: number;
}

export function MissionControlCard(props: {
  workflowId: string;
  projectId?: string;
  summary: MissionControlSummary;
  totalCostUsd: number;
  feedback: string;
  onFeedbackChange(value: string): void;
  onPause(): void;
  onResume(): void;
  onCancel(): void;
  onManualRework(): void;
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
        <MissionMetric label="Running" value={props.summary.running} />
        <MissionMetric label="Blocked" value={props.summary.blocked} />
        <MissionMetric label="Completed" value={props.summary.completed} />
        <MissionMetric label="Failed" value={props.summary.failed} />
      </div>
      <label htmlFor="workflow-manual-rework">Manual rework feedback</label>
      <textarea
        id="workflow-manual-rework"
        className="input"
        rows={3}
        value={props.feedback}
        onChange={(event) => props.onFeedbackChange(event.target.value)}
      />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>${props.totalCostUsd.toFixed(4)}</strong>
        <button type="button" className="button" onClick={props.onManualRework}>
          Manual Rework
        </button>
      </div>
    </div>
  );
}

export function WorkflowSwimlanesCard(props: {
  phases: DashboardWorkflowPhaseRow[];
  phaseGroups: Array<{ phaseName: string; tasks: DashboardWorkflowTaskRow[] }>;
  getPhaseFeedback(phaseName: string): string;
  getOverrideInput(phaseName: string): string;
  getOverrideError(phaseName: string): string | null;
  onPhaseFeedbackChange(phaseName: string, value: string): void;
  onOverrideInputChange(phaseName: string, value: string): void;
  onApprove(phaseName: string): void;
  onReject(phaseName: string): void;
  onRequestChanges(phaseName: string): void;
  onCancelPhase(phaseName: string): void;
}) {
  return (
    <div className="card">
      <h3>Workflow Swimlanes</h3>
      <p className="muted">Phases, gate state, and per-phase task grouping for operator control.</p>
      <div className="phase-lane-grid">
        {props.phases.map((phase) => (
          <article key={phase.name} className="card phase-lane">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="grid" style={{ gap: '0.35rem' }}>
                <strong>{phase.name}</strong>
                <div className="row">
                  <span className={`status-badge status-${phase.status}`}>{phase.status}</span>
                  <span className="status-badge">{phase.completed_tasks}/{phase.total_tasks} complete</span>
                  {phase.gate !== 'none' ? <span className="status-badge">Gate: {phase.gate_status}</span> : null}
                </div>
              </div>
              <button type="button" className="button" onClick={() => props.onCancelPhase(phase.name)}>
                Cancel Phase
              </button>
            </div>
            {(phase.gate_status === 'awaiting_approval' || phase.gate_status === 'rejected') ? (
              <div className="grid">
                <label htmlFor={`phase-feedback-${phase.name}`}>Gate feedback</label>
                <textarea
                  id={`phase-feedback-${phase.name}`}
                  className="input"
                  rows={3}
                  value={props.getPhaseFeedback(phase.name)}
                  onChange={(event) => props.onPhaseFeedbackChange(phase.name, event.target.value)}
                />
                <label htmlFor={`phase-override-${phase.name}`}>Clarification override JSON</label>
                <textarea
                  id={`phase-override-${phase.name}`}
                  className="input"
                  rows={6}
                  value={props.getOverrideInput(phase.name)}
                  onChange={(event) => props.onOverrideInputChange(phase.name, event.target.value)}
                />
                {props.getOverrideError(phase.name) ? <p style={{ color: '#dc2626' }}>{props.getOverrideError(phase.name)}</p> : null}
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="button" onClick={() => props.onReject(phase.name)}>Reject</button>
                  <button type="button" className="button" onClick={() => props.onRequestChanges(phase.name)}>Request Changes</button>
                  <button type="button" className="button primary" onClick={() => props.onApprove(phase.name)}>Approve</button>
                </div>
              </div>
            ) : null}
            <div className="grid">
              {(props.phaseGroups.find((entry) => entry.phaseName === phase.name)?.tasks ?? []).map((task) => (
                <Link className="card phase-task-card" key={task.id} to={`/tasks/${task.id}`}>
                  <strong>{task.title}</strong>
                  <div className="row">
                    <span className={`status-badge status-${task.state}`}>{task.state}</span>
                    <span className="muted">{task.depends_on.length > 0 ? task.depends_on.join(', ') : 'No dependencies'}</span>
                  </div>
                </Link>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function TaskGraphCard(props: {
  tasks: DashboardWorkflowTaskRow[];
  phaseGroups: Array<{ phaseName: string; tasks: DashboardWorkflowTaskRow[] }>;
  isLoading: boolean;
  hasError: boolean;
}) {
  return (
    <div className="card">
      <h3>Task Graph</h3>
      <p className="muted">Dependency graph grouped by workflow phase for faster operator scanning.</p>
      {props.isLoading ? <p>Loading tasks...</p> : null}
      {props.hasError ? <p style={{ color: '#dc2626' }}>Failed to load tasks</p> : null}
      <div className="grid">
        {props.phaseGroups.map((group) => (
          <div key={group.phaseName} className="card timeline-entry">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{group.phaseName}</strong>
              <span className="status-badge">{group.tasks.length} tasks</span>
            </div>
            <table className="table">
              <thead>
                <tr><th>Task</th><th>State</th><th>Depends On</th></tr>
              </thead>
              <tbody>
                {group.tasks.map((task) => (
                  <tr key={task.id}>
                    <td><Link to={`/tasks/${task.id}`}>{task.title}</Link></td>
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
}) {
  return (
    <div className="card">
      <h3>Project Timeline</h3>
      <p className="muted">Run-level continuity for this project, including chained lineage.</p>
      {props.isLoading ? <p>Loading timeline...</p> : null}
      {props.hasError ? <p style={{ color: '#dc2626' }}>Failed to load project timeline.</p> : null}
      <div className="grid">
        {props.entries.map((entry) => (
          <article key={entry.workflow_id} className="card timeline-entry">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{entry.name}</strong>
              <span className={`status-badge status-${entry.state}`}>{entry.state}</span>
            </div>
            <p className="muted">{entry.completed_at ? new Date(entry.completed_at).toLocaleString() : 'In progress'}</p>
            <div className="row">
              <span className="status-badge">Duration: {entry.duration_seconds ?? 0}s</span>
              <span className="status-badge">Artifacts: {entry.produced_artifacts?.length ?? 0}</span>
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
