import { sanitizeSecretLikeRecord, sanitizeSecretLikeValue } from './secret-redaction.js';

const GATE_SECRET_REDACTION = 'redacted://gate-secret';

export interface WorkflowStageGateRecord {
  id: string;
  workflow_id: string;
  workflow_name?: string | null;
  stage_id?: string | null;
  stage_name: string;
  stage_goal?: string | null;
  status: string;
  request_summary?: string | null;
  recommendation: string | null;
  concerns: unknown;
  key_artifacts: unknown;
  requested_by_type?: string | null;
  requested_by_id?: string | null;
  requested_at: Date;
  updated_at?: Date | null;
  decided_by_type?: string | null;
  decided_by_id?: string | null;
  decision_feedback?: string | null;
  decided_at?: Date | null;
  requested_by_task_id?: string | null;
  requested_by_task_title?: string | null;
  requested_by_task_role?: string | null;
  requested_by_work_item_id?: string | null;
  requested_by_work_item_title?: string | null;
  resume_activation_id?: string | null;
  resume_activation_state?: string | null;
  resume_activation_event_type?: string | null;
  resume_activation_reason?: string | null;
  resume_activation_queued_at?: Date | null;
  resume_activation_started_at?: Date | null;
  resume_activation_completed_at?: Date | null;
  resume_activation_summary?: string | null;
  resume_activation_error?: Record<string, unknown> | null;
  resume_activation_history?: unknown;
  decision_history?: unknown;
}

export function toGateResponse(row: WorkflowStageGateRecord) {
  const resumeHistory = normalizeResumeHistory(row);
  const latestResume = resumeHistory[resumeHistory.length - 1] ?? null;
  const requestSummary = sanitizeGateString(row.request_summary);
  const recommendation = sanitizeGateString(row.recommendation);
  const decisionFeedback = sanitizeGateString(row.decision_feedback);
  return {
    id: row.id,
    gate_id: row.id,
    workflow_id: row.workflow_id,
    workflow_name: row.workflow_name ?? null,
    stage_id: row.stage_id ?? null,
    stage_name: row.stage_name,
    stage_goal: row.stage_goal ?? null,
    status: row.status,
    gate_status: row.status,
    request_summary: requestSummary,
    summary: requestSummary,
    recommendation,
    concerns: normalizeStringArray(sanitizeGateValue(row.concerns)),
    key_artifacts: normalizeRecordArray(sanitizeGateValue(row.key_artifacts)),
    requested_by_type: row.requested_by_type ?? null,
    requested_by_id: row.requested_by_id ?? null,
    decided_by_type: row.decided_by_type ?? null,
    decided_by_id: row.decided_by_id ?? null,
    decision_feedback: decisionFeedback,
    human_decision: {
      action: decisionActionForStatus(row.status),
      decided_by_type: row.decided_by_type ?? null,
      decided_by_id: row.decided_by_id ?? null,
      feedback: decisionFeedback,
      decided_at: row.decided_at?.toISOString() ?? null,
    },
    decision_history: normalizeDecisionHistory(row.decision_history),
    requested_by_task: row.requested_by_task_id
      ? {
          id: row.requested_by_task_id,
          title: sanitizeGateString(row.requested_by_task_title),
          role: row.requested_by_task_role ?? null,
          work_item_id: row.requested_by_work_item_id ?? null,
          work_item_title: sanitizeGateString(row.requested_by_work_item_title),
        }
      : null,
    orchestrator_resume: latestResume,
    orchestrator_resume_history: resumeHistory,
    requested_at: row.requested_at.toISOString(),
    decided_at: row.decided_at?.toISOString() ?? null,
    updated_at: (row.updated_at ?? row.requested_at).toISOString(),
  };
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function normalizeRecordArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Record<string, unknown>[];
  }
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  );
}

function decisionActionForStatus(status: string | null | undefined) {
  if (status === 'approved') {
    return 'approve';
  }
  if (status === 'changes_requested') {
    return 'request_changes';
  }
  if (status === 'rejected') {
    return 'reject';
  }
  return null;
}

function normalizeDecisionHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Array<{
      action: string;
      actor_type: string | null;
      actor_id: string | null;
      feedback: string | null;
      created_at: string | null;
    }>;
  }
  return value
    .filter(
      (
        entry,
      ): entry is {
        action?: unknown;
        actor_type?: unknown;
        actor_id?: unknown;
        feedback?: unknown;
        created_at?: unknown;
      } => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
    )
    .map((entry) => ({
      action: typeof entry.action === 'string' ? entry.action : 'unknown',
      actor_type: typeof entry.actor_type === 'string' ? entry.actor_type : null,
      actor_id: typeof entry.actor_id === 'string' ? entry.actor_id : null,
      feedback: sanitizeGateString(entry.feedback),
      created_at: typeof entry.created_at === 'string' ? entry.created_at : null,
    }));
}

function normalizeResumeHistory(row: WorkflowStageGateRecord) {
  const explicitHistory = normalizeResumeHistoryArray(row.resume_activation_history);
  if (explicitHistory.length > 0) {
    return explicitHistory;
  }
  if (!row.resume_activation_id) {
    return [] as Array<{
      activation_id: string;
      state: string | null;
      event_type: string | null;
      reason: string | null;
      queued_at: string | null;
      started_at: string | null;
      completed_at: string | null;
      summary: string | null;
      error: Record<string, unknown> | null;
      latest_event_at: string | null;
      event_count: number;
      task: {
        id: string;
        title: string | null;
        state: string | null;
        started_at: string | null;
        completed_at: string | null;
      } | null;
    }>;
  }
  return [
    {
      activation_id: row.resume_activation_id,
      state: row.resume_activation_state ?? null,
      event_type: row.resume_activation_event_type ?? null,
      reason: row.resume_activation_reason ?? null,
      queued_at: row.resume_activation_queued_at?.toISOString() ?? null,
      started_at: row.resume_activation_started_at?.toISOString() ?? null,
      completed_at: row.resume_activation_completed_at?.toISOString() ?? null,
      summary: sanitizeGateString(row.resume_activation_summary),
      error: sanitizeGateRecord(row.resume_activation_error),
      latest_event_at:
        row.resume_activation_completed_at?.toISOString()
        ?? row.resume_activation_started_at?.toISOString()
        ?? row.resume_activation_queued_at?.toISOString()
        ?? null,
      event_count: 1,
      task: null,
    },
  ];
}

function normalizeResumeHistoryArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Array<{
      activation_id: string;
      state: string | null;
      event_type: string | null;
      reason: string | null;
      queued_at: string | null;
      started_at: string | null;
      completed_at: string | null;
      summary: string | null;
      error: Record<string, unknown> | null;
      latest_event_at: string | null;
      event_count: number;
      task: {
        id: string;
        title: string | null;
        state: string | null;
        started_at: string | null;
        completed_at: string | null;
      } | null;
    }>;
  }

  return value
    .filter(
      (
        entry,
      ): entry is {
        activation_id?: unknown;
        state?: unknown;
        event_type?: unknown;
        reason?: unknown;
        queued_at?: unknown;
        started_at?: unknown;
        completed_at?: unknown;
        summary?: unknown;
        error?: unknown;
        latest_event_at?: unknown;
        event_count?: unknown;
        task?: {
          id?: unknown;
          title?: unknown;
          state?: unknown;
          started_at?: unknown;
          completed_at?: unknown;
        } | null;
      } => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
    )
    .map((entry) => ({
      activation_id:
        typeof entry.activation_id === 'string' ? entry.activation_id : 'unknown',
      state: typeof entry.state === 'string' ? entry.state : null,
      event_type: typeof entry.event_type === 'string' ? entry.event_type : null,
      reason: typeof entry.reason === 'string' ? entry.reason : null,
      queued_at: typeof entry.queued_at === 'string' ? entry.queued_at : null,
      started_at: typeof entry.started_at === 'string' ? entry.started_at : null,
      completed_at: typeof entry.completed_at === 'string' ? entry.completed_at : null,
      summary: sanitizeGateString(entry.summary),
      error: sanitizeGateRecord(entry.error),
      latest_event_at: typeof entry.latest_event_at === 'string' ? entry.latest_event_at : null,
      event_count:
        typeof entry.event_count === 'number' && Number.isFinite(entry.event_count)
          ? entry.event_count
          : 1,
      task:
        entry.task
          && typeof entry.task === 'object'
          && typeof entry.task.id === 'string'
          ? {
              id: entry.task.id,
              title: sanitizeGateString(entry.task.title),
              state: typeof entry.task.state === 'string' ? entry.task.state : null,
              started_at:
                typeof entry.task.started_at === 'string' ? entry.task.started_at : null,
              completed_at:
                typeof entry.task.completed_at === 'string' ? entry.task.completed_at : null,
            }
          : null,
    }));
}

function sanitizeGateString(value: unknown): string | null {
  const sanitized = sanitizeSecretLikeValue(value, {
    redactionValue: GATE_SECRET_REDACTION,
  });
  return typeof sanitized === 'string' ? sanitized : null;
}

function sanitizeGateRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return sanitizeSecretLikeRecord(value, { redactionValue: GATE_SECRET_REDACTION });
}

function sanitizeGateValue(value: unknown): unknown {
  return sanitizeSecretLikeValue(value, { redactionValue: GATE_SECRET_REDACTION });
}
