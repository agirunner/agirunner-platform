import { completionCalloutsSchema, guidedClosureSuggestedActionSchema, guidedClosureWaivedStepSchema } from '../guided-closure/types.js';
import { sanitizeSecretLikeRecord, sanitizeSecretLikeValue } from '../secret-redaction.js';
import type { TaskHandoffRow } from './handoff-service.types.js';

const HANDOFF_SECRET_REDACTION = 'redacted://handoff-secret';

export function sanitizeHandoffValue(value: unknown): unknown {
  return sanitizeSecretLikeValue(value, {
    redactionValue: HANDOFF_SECRET_REDACTION,
  });
}

export function sanitizeHandoffRecord(value: unknown): Record<string, unknown> {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: HANDOFF_SECRET_REDACTION,
  });
}

export function toTaskHandoffResponse(row: TaskHandoffRow) {
  const sanitized = sanitizeHandoffValue(row) as TaskHandoffRow;
  const roleData = normalizeRecord(sanitized.role_data);
  const branchId =
    normalizeUUIDString(sanitized.branch_id)
    ?? normalizeUUIDString(roleData.branch_id);
  return {
    ...sanitized,
    completion_state: normalizeCompletionState(sanitized.completion_state ?? sanitized.completion),
    decision_state: normalizeHandoffResolution(sanitized.decision_state ?? sanitized.resolution),
    subject_ref:
      sanitizeNullableSubjectRef(sanitized.subject_ref)
      ?? deriveSubjectRef(roleData, branchId),
    subject_revision:
      readOptionalPositiveInteger(sanitized.subject_revision)
      ?? readOptionalPositiveInteger(roleData.subject_revision),
    outcome_action_applied: readOptionalString(sanitized.outcome_action_applied),
    closure_effect: normalizeClosureEffect(roleData.closure_effect),
    branch_id: branchId,
    recommended_next_actions: normalizeArray(sanitized.recommended_next_actions),
    waived_steps: normalizeArray(sanitized.waived_steps),
    completion_callouts: completionCalloutsSchema.parse(sanitized.completion_callouts ?? {}),
    created_at: row.created_at.toISOString(),
  };
}

export function normalizeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

export function normalizeRecommendedNextActions(value: unknown) {
  return guidedClosureSuggestedActionSchema.array().max(100).parse(normalizeArray(sanitizeHandoffValue(value)));
}

export function normalizeWaivedSteps(value: unknown, completionCallouts: unknown) {
  const explicit = guidedClosureWaivedStepSchema.array().max(100).parse(normalizeArray(sanitizeHandoffValue(value)));
  if (explicit.length > 0) {
    return explicit;
  }
  return completionCalloutsSchema.parse(sanitizeHandoffValue(completionCallouts ?? {})).waived_steps;
}

export function normalizeCompletionCallouts(value: unknown, waivedSteps: unknown) {
  const parsed = completionCalloutsSchema.parse(sanitizeHandoffValue(value ?? {}));
  const explicitWaivedSteps = guidedClosureWaivedStepSchema.array().max(100).safeParse(
    normalizeArray(sanitizeHandoffValue(waivedSteps)),
  );
  if (!explicitWaivedSteps.success || explicitWaivedSteps.data.length === 0) {
    return parsed;
  }
  return completionCalloutsSchema.parse({
    ...parsed,
    waived_steps: explicitWaivedSteps.data,
  });
}

export function normalizeRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
  ) as T;
}

export function readOptionalPositiveInteger(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

export function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function normalizeUUIDString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function serializeJsonb(value: unknown) {
  return JSON.stringify(value);
}

export function isEditableTaskState(state: string | null) {
  return state === 'pending' || state === 'claimed' || state === 'in_progress';
}

export function emptyCompletionCallouts() {
  return completionCalloutsSchema.parse({});
}

function sanitizeNullableSubjectRef(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return sanitizeHandoffRecord(value);
}

function normalizeCompletionState(value: unknown): 'full' | 'blocked' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'full' || normalized === 'blocked' ? normalized : null;
}

function normalizeHandoffResolution(
  value: unknown,
): 'approved' | 'request_changes' | 'rejected' | 'blocked' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'approved'
    || normalized === 'request_changes'
    || normalized === 'rejected'
    || normalized === 'blocked'
    ? normalized
    : null;
}

function normalizeClosureEffect(value: unknown): 'blocking' | 'advisory' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'blocking' || normalized === 'advisory' ? normalized : null;
}

function deriveSubjectRef(roleData: Record<string, unknown>, branchId: string | null) {
  if (branchId) {
    return compactRecord({
      kind: 'branch',
      branch_id: branchId,
      task_id: readOptionalString(roleData.subject_task_id),
      work_item_id: readOptionalString(roleData.subject_work_item_id),
      handoff_id: readOptionalString(roleData.subject_handoff_id),
    });
  }

  const taskId = readOptionalString(roleData.subject_task_id);
  const workItemId = readOptionalString(roleData.subject_work_item_id);
  const handoffId = readOptionalString(roleData.subject_handoff_id);
  if (taskId) {
    return compactRecord({
      kind: 'task',
      task_id: taskId,
      work_item_id: workItemId,
      handoff_id: handoffId,
    });
  }
  if (workItemId) {
    return compactRecord({
      kind: 'work_item',
      work_item_id: workItemId,
      handoff_id: handoffId,
    });
  }
  if (handoffId) {
    return { kind: 'handoff', handoff_id: handoffId };
  }
  return null;
}
