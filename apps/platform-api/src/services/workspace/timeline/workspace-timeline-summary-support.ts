import { buildPlaybookRunSummary } from '../../playbook-run-summary/playbook-run-summary.js';

export type WorkflowSummarySource = Record<string, unknown>;

export interface WorkflowSummarySnapshot {
  tasks: WorkflowSummarySource[];
  artifacts: WorkflowSummarySource[];
  events: WorkflowSummarySource[];
  stages: WorkflowSummarySource[];
  workItems: WorkflowSummarySource[];
  activations: WorkflowSummarySource[];
  gates: WorkflowSummarySource[];
}

export function buildWorkflowSummary(
  workflowRow: WorkflowSummarySource,
  snapshot: WorkflowSummarySnapshot,
): Record<string, unknown> {
  return buildPlaybookRunSummary({
    workflow: workflowRow,
    tasks: snapshot.tasks,
    stages: snapshot.stages.map((row) => ({
      name: String(row.name),
      goal: String(row.goal),
      status: String(row.status),
      gate_status: String(row.gate_status),
      iteration_count: Number(row.iteration_count ?? 0),
      summary: typeof row.summary === 'string' ? row.summary : null,
      started_at: asDate(row.started_at),
      completed_at: asDate(row.completed_at),
    })),
    workItems: snapshot.workItems.map((row) => ({
      id: String(row.id),
      stage_name: String(row.stage_name),
      column_id: String(row.column_id),
      title: String(row.title),
      completed_at: asDate(row.completed_at),
    })),
    artifacts: snapshot.artifacts.map((row) => ({
      id: String(row.id),
      task_id: String(row.task_id),
      logical_path: String(row.logical_path),
      content_type: String(row.content_type),
      size_bytes: Number(row.size_bytes ?? 0),
      created_at: new Date(String(row.created_at)),
    })),
    events: snapshot.events.map((row) => ({
      type: String(row.type),
      actor_type: String(row.actor_type),
      actor_id: typeof row.actor_id === 'string' ? row.actor_id : null,
      data: asRecord(row.data),
      created_at: new Date(String(row.created_at)),
    })),
    activations: snapshot.activations.map((row) => ({
      activation_id:
        typeof row.activation_id === 'string' && row.activation_id.length > 0
          ? row.activation_id
          : null,
      state: String(row.state),
      reason: typeof row.reason === 'string' && row.reason.length > 0 ? row.reason : null,
      event_type: String(row.event_type),
      task_id: typeof row.task_id === 'string' && row.task_id.length > 0 ? row.task_id : null,
      queued_at: new Date(String(row.queued_at)),
      started_at: asDate(row.started_at),
      consumed_at: asDate(row.consumed_at),
      completed_at: asDate(row.completed_at),
      error: asRecordOrNull(row.error),
    })),
    gates: snapshot.gates.map((row) => ({
      id: String(row.id),
      stage_name: String(row.stage_name),
      status: String(row.status),
      request_summary: String(row.request_summary),
      recommendation:
        typeof row.recommendation === 'string' && row.recommendation.length > 0
          ? row.recommendation
          : null,
      concerns: Array.isArray(row.concerns) ? row.concerns : [],
      key_artifacts: Array.isArray(row.key_artifacts) ? row.key_artifacts : [],
      requested_by_type: String(row.requested_by_type),
      requested_by_id:
        typeof row.requested_by_id === 'string' && row.requested_by_id.length > 0
          ? row.requested_by_id
          : null,
      requested_at: new Date(String(row.requested_at)),
      decision_feedback:
        typeof row.decision_feedback === 'string' && row.decision_feedback.length > 0
          ? row.decision_feedback
          : null,
      decided_by_type:
        typeof row.decided_by_type === 'string' && row.decided_by_type.length > 0
          ? row.decided_by_type
          : null,
      decided_by_id:
        typeof row.decided_by_id === 'string' && row.decided_by_id.length > 0
          ? row.decided_by_id
          : null,
      decided_at: asDate(row.decided_at),
    })),
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
