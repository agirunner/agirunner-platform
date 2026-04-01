import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import type { WorkItemCompletionOutcome } from '../work-item-continuity-service/work-item-continuity-service.js';
import { readAssessmentSubjectLinkage, readWorkflowTaskKind } from '../workflow-task-policy/assessment-subject-service.js';

export interface SubjectTaskCandidateLookup {
  result: { rows: Record<string, unknown>[]; rowCount: number };
  resolutionSource: 'explicit_subject_task_id' | 'none';
  explicitSubjectTaskId: string | null;
}

export interface SubjectTaskCandidateOptions {
  allowCompletedExplicitTask?: boolean;
}

export type TaskCompletionContinuityEvent = 'task_completed' | 'assessment_requested_changes';

export interface TaskAttemptHandoffOutcome {
  completion: string | null;
  resolution: string | null;
  summary: string | null;
  outcome_action_applied: string | null;
}

export interface SubjectTaskChangeService {
  requestTaskChanges: (
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      feedback: string;
      override_input?: Record<string, unknown>;
      preferred_agent_id?: string;
      preferred_worker_id?: string;
    },
    client?: DatabaseClient,
  ) => Promise<Record<string, unknown>>;
  rejectTask?: (
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      feedback: string;
      record_continuity?: boolean;
    },
    client?: DatabaseClient,
  ) => Promise<Record<string, unknown>>;
}

export interface OngoingWorkflowClosureContextRow {
  lifecycle: string | null;
  definition: unknown;
}

export interface OngoingWorkItemClosureCandidateRow {
  stage_name: string | null;
  column_id: string;
  completed_at: Date | null;
  blocked_state: string | null;
  escalation_status: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
}

export type ExplicitAssessmentOutcomeAction =
  | 'block_subject'
  | 'escalate'
  | 'terminate_branch';

export interface AssessmentResolutionGate {
  shouldAttempt: boolean;
  reason: string;
}

export type { WorkItemCompletionOutcome } from '../work-item-continuity-service/work-item-continuity-service.js';

export function validateOutputSchema(output: unknown, schema: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!schema || typeof schema !== 'object') {
    return errors;
  }

  const requiredFields = schema.required as string[] | undefined;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;

  if (!output || typeof output !== 'object') {
    errors.push('Output must be an object');
    return errors;
  }

  const outputRecord = output as Record<string, unknown>;

  if (requiredFields) {
    for (const field of requiredFields) {
      if (!(field in outputRecord)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  if (properties) {
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in outputRecord && propSchema.type) {
        const value = outputRecord[key];
        const expectedType = propSchema.type as string;
        if (expectedType === 'string' && typeof value !== 'string') {
          errors.push(`Field ${key} must be a string`);
        } else if (expectedType === 'number' && typeof value !== 'number') {
          errors.push(`Field ${key} must be a number`);
        } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
          errors.push(`Field ${key} must be a boolean`);
        } else if (expectedType === 'array' && !Array.isArray(value)) {
          errors.push(`Field ${key} must be an array`);
        } else if (expectedType === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
          errors.push(`Field ${key} must be an object`);
        }
      }
    }
  }

  return errors;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function readSubjectTaskId(completedTask: Record<string, unknown>) {
  return readAssessmentSubjectLinkage(completedTask.input, completedTask.metadata).subjectTaskId;
}

export function readSubjectRevision(completedTask: Record<string, unknown>) {
  return readAssessmentSubjectLinkage(completedTask.input, completedTask.metadata).subjectRevision;
}

export function readBranchId(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = asOptionalString(record.branch_id);
  if (direct) {
    return direct;
  }
  const metadata = asRecord(record.metadata);
  return asOptionalString(metadata.branch_id);
}

export function normalizeAssessmentOutcome(value: unknown) {
  const normalized = asOptionalString(value)?.toLowerCase();
  return normalized === 'approved'
    || normalized === 'request_changes'
    || normalized === 'rejected'
    || normalized === 'blocked'
    ? normalized
    : null;
}

export function resolveExplicitAssessmentOutcomeAction(
  latestHandoffOutcome: TaskAttemptHandoffOutcome | null,
): { action: ExplicitAssessmentOutcomeAction } | null {
  const action = asOptionalString(latestHandoffOutcome?.outcome_action_applied);
  if (!action) {
    return null;
  }
  if (action === 'block_subject' || action === 'escalate' || action === 'terminate_branch') {
    return { action };
  }
  return null;
}

export function readRequestChangesFeedback(
  completedTask: Record<string, unknown>,
  latestHandoffOutcome: TaskAttemptHandoffOutcome | null,
) {
  return readAssessmentResolutionFeedback(
    completedTask,
    latestHandoffOutcome,
    'Assessment requested changes.',
  );
}

export function readAssessmentResolutionFeedback(
  completedTask: Record<string, unknown>,
  latestHandoffOutcome: TaskAttemptHandoffOutcome | null,
  fallback: string,
) {
  return (
    asOptionalString(latestHandoffOutcome?.summary)
    ?? asOptionalString(asRecord(completedTask.output).assessment_feedback)
    ?? asOptionalString(asRecord(completedTask.output).summary)
    ?? fallback
  );
}

export function readsAssessmentRequestChangesOutcome(
  completedTask: Record<string, unknown>,
  latestHandoffOutcome: TaskAttemptHandoffOutcome,
) {
  if (latestHandoffOutcome.resolution === 'request_changes') {
    return true;
  }

  const output = asRecord(completedTask.output);
  return (
    normalizeAssessmentOutcome(output.resolution) === 'request_changes'
    || normalizeAssessmentOutcome(output.verdict) === 'request_changes'
  );
}

export function readsAssessmentApprovedOutcome(
  completedTask: Record<string, unknown>,
  latestHandoffOutcome: TaskAttemptHandoffOutcome | null,
) {
  if (latestHandoffOutcome?.resolution === 'approved') {
    return true;
  }

  const output = asRecord(completedTask.output);
  return (
    normalizeAssessmentOutcome(output.resolution) === 'approved'
    || normalizeAssessmentOutcome(output.verdict) === 'approved'
  );
}

export function resolveAssessmentResolutionGate(
  completedTask: Record<string, unknown>,
  continuityResult: WorkItemCompletionOutcome | null,
): AssessmentResolutionGate {
  if (!isAssessmentTaskCandidate(completedTask)) {
    return { shouldAttempt: false, reason: 'not_assessment_candidate' };
  }

  if (!readSubjectTaskId(completedTask)) {
    return { shouldAttempt: false, reason: 'missing_subject_task_id' };
  }

  if (continuityResult?.satisfiedAssessmentExpectation) {
    return { shouldAttempt: true, reason: 'continuity_expectation' };
  }

  return { shouldAttempt: true, reason: 'explicit_subject_task_id' };
}

export function isAssessmentTaskCandidate(completedTask: Record<string, unknown>) {
  return readWorkflowTaskKind(completedTask.metadata, Boolean(completedTask.is_orchestrator_task)) === 'assessment';
}
