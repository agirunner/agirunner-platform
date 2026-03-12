import type { Task } from '@agirunner/sdk';
import { normalizeTaskState as normalizeDashboardTaskState } from '../lib/task-state.js';

type TaskWithStatus = Task & { status?: string | null };

export interface ClarificationEntry {
  feedback?: string;
  answered_at?: string;
  answered_by?: string;
  answers?: Record<string, unknown>;
}

export interface TaskNextStep {
  title: string;
  detail: string;
}

export interface TaskReviewSignals {
  reviewAction?: string;
  reviewFeedback?: string;
  reviewUpdatedAt?: string;
  escalationReason?: string;
  escalationTarget?: string;
  escalationContext?: string;
  escalationAwaitingHuman: boolean;
}

export function parseJsonObject(value: string, errorMessage: string) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: null, error: errorMessage };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch {
    return { value: null, error: errorMessage };
  }
}

export function normalizeTaskState(value: string | null | undefined) {
  return normalizeDashboardTaskState(value);
}

export function readClarificationHistory(task: Task | null) {
  const input = asRecord(task?.input);
  const history = Array.isArray(input.clarification_history) ? input.clarification_history : [];
  return history.map((entry) => {
    const record = asRecord(entry);
    return {
      feedback: readString(record.feedback),
      answered_at: readString(record.answered_at),
      answered_by: readString(record.answered_by),
      answers: asRecord(record.answers),
    } satisfies ClarificationEntry;
  });
}

export function readClarificationAnswers(task: Task | null) {
  return asRecord(asRecord(task?.input).clarification_answers);
}

export function readReworkDetails(task: Task | null) {
  const metadata = asRecord(task?.metadata);
  return {
    reworkCount: readNumber((task as Task & { rework_count?: number } | null)?.rework_count),
    reviewAction: readString(metadata.review_action),
    reviewFeedback: readString(metadata.review_feedback),
    clarificationRequested: metadata.clarification_requested === true,
  };
}

export function readHumanEscalationResponse(task: Task | null) {
  const input = asRecord(task?.input);
  return asRecord(input.human_escalation_response);
}

export function readExecutionSummary(task: Task | null) {
  return {
    metrics: asRecord((task as Task & { metrics?: unknown } | null)?.metrics),
    verification: asRecord((task as Task & { verification?: unknown } | null)?.verification),
    metadata: asRecord(task?.metadata),
  };
}

export function readReviewSignals(task: Task | null): TaskReviewSignals {
  const metadata = asRecord(task?.metadata);
  return {
    reviewAction: readString(metadata.review_action),
    reviewFeedback: readString(metadata.review_feedback),
    reviewUpdatedAt: readString(metadata.review_updated_at),
    escalationReason: readString(metadata.escalation_reason),
    escalationTarget: readString(metadata.escalation_target),
    escalationContext: readString(metadata.escalation_context),
    escalationAwaitingHuman: metadata.escalation_awaiting_human === true,
  };
}

export function buildTaskNextStep(task: TaskWithStatus | null): TaskNextStep {
  const state = normalizeTaskState(task?.state ?? task?.status);
  if (state === 'awaiting_approval') {
    return {
      title: 'Approve or reject this specialist step',
      detail:
        'Review the work-item packet, decide whether the step should advance, and keep the board state aligned with the operator decision.',
    };
  }
  if (state === 'output_pending_review') {
    return {
      title: 'Review the output packet',
      detail:
        'Validate the task output, supporting artifacts, and acceptance signal before approving or requesting changes.',
    };
  }
  if (state === 'escalated') {
    return {
      title: 'Resolve the escalation path',
      detail:
        'Use the escalation context, human response, and work-item thread to decide whether to resume, redirect, or rework the task.',
    };
  }
  if (state === 'failed') {
    return {
      title: 'Inspect failure context before retrying',
      detail:
        'Check logs, execution metrics, and related workflow state so a retry is intentional rather than repetitive.',
    };
  }
  if (state === 'in_progress') {
    return {
      title: 'Monitor execution and intervene only if needed',
      detail:
        'Track logs, artifacts, and cost while the specialist is active. Cancel only if the work is invalid or superseded.',
    };
  }
  if (state === 'completed') {
    return {
      title: 'Confirm downstream workflow impact',
      detail:
        'Inspect the final output and linked work-item state so follow-on work or approval gates stay coherent.',
    };
  }
  return {
    title: 'Review task context before acting',
    detail:
      'Use the workflow scope, current status, and task packet to decide the safest next operator action.',
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
