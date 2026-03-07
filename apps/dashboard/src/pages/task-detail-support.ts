import type { Task } from '@agirunner/sdk';

export interface ClarificationEntry {
  feedback?: string;
  answered_at?: string;
  answered_by?: string;
  answers?: Record<string, unknown>;
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
