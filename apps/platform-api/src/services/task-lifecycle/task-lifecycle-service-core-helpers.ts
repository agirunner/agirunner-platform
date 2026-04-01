import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import {
  activeColumnId,
  defaultColumnId,
  parsePlaybookDefinition,
} from '../../orchestration/playbook-model.js';
import {
  normalizeTaskState,
  type TaskState,
} from '../../orchestration/task-state-machine.js';
import {
  calculateRetryBackoffSeconds,
  type EscalationPolicy,
  type LifecyclePolicy,
  type RetryPolicy,
} from './task-lifecycle-policy.js';
import { areJsonValuesEquivalent } from '../json-equivalence.js';
import { readAssessmentSubjectLinkage } from '../workflow-task-policy/assessment-subject-service.js';

export interface ReworkWorkItemContextRow {
  workflow_id: string;
  work_item_id: string;
  stage_name: string | null;
  column_id: string | null;
  completed_at: Date | null;
  workflow_state: string | null;
  workflow_metadata: unknown;
  definition: unknown;
}

export interface WorkItemExecutionColumnContextRow {
  workflow_id: string;
  work_item_id: string;
  stage_name: string | null;
  column_id: string | null;
  completed_at: Date | null;
  blocked_state: string | null;
  escalation_status: string | null;
  definition: unknown;
}

export interface WorkItemExecutionProgressRow {
  engaged_task_count: string | number;
}

export interface LatestAssessmentRequestHandoffRow {
  handoff_id: string;
  assessment_task_id: string;
  created_at: Date | null;
}

export const ACTIVE_PARALLELISM_SLOT_STATES: TaskState[] = [
  'ready',
  'claimed',
  'in_progress',
  'awaiting_approval',
];
export const DEFAULT_ORCHESTRATOR_ESCALATION_TARGET = 'human';
export const DEFAULT_ORCHESTRATOR_MAX_ESCALATION_DEPTH = 1;
export const REWORK_REQUIRED_MARKER = '\n\nRework required:\n';

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function normalizeTaskRecord(task: Record<string, unknown>): Record<string, unknown> {
  const normalizedState = normalizeTaskState(task.state as string | null | undefined);
  return normalizedState ? { ...task, state: normalizedState } : task;
}

export function isJsonEquivalent(left: unknown, right: unknown): boolean {
  return areJsonValuesEquivalent(left, right);
}

export function readOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function readTaskKind(task: Record<string, unknown>): 'delivery' | 'assessment' | 'approval' | 'orchestrator' {
  const taskKind = readOptionalText(asRecord(task.metadata).task_kind);
  if (taskKind === 'assessment' || taskKind === 'approval' || taskKind === 'orchestrator' || taskKind === 'delivery') {
    return taskKind;
  }
  if (task.is_orchestrator_task === true) {
    return 'orchestrator';
  }
  return 'delivery';
}

export function buildOutputRevisionMetadataPatch(task: Record<string, unknown>) {
  const taskKind = readTaskKind(task);
  if (taskKind === 'assessment' || taskKind === 'approval' || taskKind === 'orchestrator') {
    return undefined;
  }
  return {
    output_revision: (readInteger(task.rework_count) ?? 0) + 1,
  };
}

export function normalizeAssessmentApprovalOutcome(value: unknown): 'approved' | null {
  return readOptionalText(value) === 'approved' ? 'approved' : null;
}

export function readAssessmentAction(metadata: Record<string, unknown>): string | null {
  return readOptionalText(metadata.assessment_action);
}

export function readAssessmentFeedback(metadata: Record<string, unknown>): string | null {
  return readOptionalText(metadata.assessment_feedback);
}

export function resolveRequestedChangesDescription(
  task: Record<string, unknown>,
  overrideInput: Record<string, unknown> | null,
  nextInput: Record<string, unknown>,
): string | null {
  const explicitOverrideDescription = readOptionalText(overrideInput?.description);
  if (explicitOverrideDescription) {
    return explicitOverrideDescription;
  }

  const taskInput = asRecord(task.input);
  const taskMetadata = asRecord(task.metadata);
  const explicitReworkScope =
    readOptionalText(taskInput.rework_completion_scope)
    ?? readOptionalText(taskMetadata.rework_completion_scope);
  if (explicitReworkScope) {
    return explicitReworkScope;
  }

  const latestFeedback = readOptionalText(nextInput.assessment_feedback);
  const baseDescription = normalizeRequestedChangesBaseDescription(
    readOptionalText(nextInput.description)
    ?? readOptionalText(taskInput.description)
    ?? readOptionalText(taskMetadata.description),
  );
  if (!latestFeedback) {
    return baseDescription;
  }
  if (!baseDescription) {
    return `Rework required:\n${latestFeedback}`;
  }
  return `${baseDescription}${REWORK_REQUIRED_MARKER}${latestFeedback}`;
}

export function normalizeRequestedChangesBaseDescription(description: string | null) {
  if (!description) {
    return null;
  }
  const markerIndex = description.indexOf(REWORK_REQUIRED_MARKER);
  if (markerIndex < 0) {
    return description;
  }
  const base = description.slice(0, markerIndex).trimEnd();
  return base.length > 0 ? base : null;
}

export function matchesReviewMetadata(
  task: Record<string, unknown>,
  expected: {
    action: string;
    feedback?: string;
    preferredAgentId?: string | null;
    preferredWorkerId?: string | null;
  },
): boolean {
  const metadata = asRecord(task.metadata);
  return (
    readAssessmentAction(metadata) === expected.action &&
    (expected.feedback === undefined || readAssessmentFeedback(metadata) === expected.feedback) &&
    (expected.preferredAgentId === undefined ||
      (metadata.preferred_agent_id ?? null) === expected.preferredAgentId) &&
    (expected.preferredWorkerId === undefined ||
      (metadata.preferred_worker_id ?? null) === expected.preferredWorkerId)
  );
}

export function hasActiveReworkRequest(task: Record<string, unknown>): boolean {
  const state = normalizeTaskState(task.state as string | null | undefined);
  if (state !== 'ready' && state !== 'claimed' && state !== 'in_progress') {
    return false;
  }
  return readAssessmentAction(asRecord(task.metadata)) === 'request_changes';
}

export function hasAppliedLatestAssessmentRequest(
  task: Record<string, unknown>,
  latestAssessmentRequest: LatestAssessmentRequestHandoffRow | null,
): boolean {
  if (!latestAssessmentRequest) {
    return false;
  }

  return readOptionalText(asRecord(task.metadata).last_applied_assessment_request_handoff_id)
    === latestAssessmentRequest.handoff_id;
}

export function hasSupersedingTaskHandoffAfterAssessmentRequest(
  task: Record<string, unknown>,
  latestAssessmentRequest: LatestAssessmentRequestHandoffRow | null,
  latestTaskHandoffCreatedAt: Date | null,
) {
  const state = normalizeTaskState(task.state as string | null | undefined);
  if (state !== 'output_pending_assessment' && state !== 'completed') {
    return false;
  }
  if (!(latestAssessmentRequest?.created_at instanceof Date) || !(latestTaskHandoffCreatedAt instanceof Date)) {
    return false;
  }
  return latestTaskHandoffCreatedAt.getTime() > latestAssessmentRequest.created_at.getTime();
}

export function hasMatchingManualEscalation(
  task: Record<string, unknown>,
  payload: {
    reason: string;
    escalation_target?: string;
    context?: Record<string, unknown>;
    recommendation?: string;
    blocking_task_id?: string;
    urgency?: 'info' | 'important' | 'critical';
  },
): boolean {
  const metadata = asRecord(task.metadata);
  const escalations = Array.isArray(metadata.escalations)
    ? (metadata.escalations as Array<Record<string, unknown>>)
    : [];
  const latestEscalation = escalations.at(-1);
  if (!latestEscalation) {
    return false;
  }
  return latestEscalation.reason === payload.reason
    && (latestEscalation.target ?? null) === (payload.escalation_target ?? null)
    && areJsonValuesEquivalent(latestEscalation.context ?? null, payload.context ?? null)
    && (latestEscalation.recommendation ?? null) === (payload.recommendation ?? null)
    && (latestEscalation.blocking_task_id ?? null) === (payload.blocking_task_id ?? null)
    && (latestEscalation.urgency ?? null) === (payload.urgency ?? null)
    && metadata.assessment_action === 'escalate'
    && metadata.assessment_feedback === payload.reason
    && areJsonValuesEquivalent(metadata.escalation_context_packet ?? null, payload.context ?? null)
    && (metadata.escalation_recommendation ?? null) === (payload.recommendation ?? null)
    && (metadata.escalation_blocking_task_id ?? null) === (payload.blocking_task_id ?? null)
    && (metadata.escalation_urgency ?? null) === (payload.urgency ?? null);
}

export function hasMatchingAgentEscalation(
  task: Record<string, unknown>,
  resolvedTarget: string,
  payload: {
    reason: string;
    context_summary?: string;
    work_so_far?: string;
  },
): boolean {
  const metadata = asRecord(task.metadata);
  if (task.state !== 'escalated') {
    return false;
  }
  if ((metadata.escalation_target ?? null) !== resolvedTarget) {
    return false;
  }
  if ((metadata.escalation_reason ?? null) !== payload.reason) {
    return false;
  }
  if ((metadata.escalation_context ?? null) !== (payload.context_summary ?? null)) {
    return false;
  }
  if ((metadata.escalation_work_so_far ?? null) !== (payload.work_so_far ?? null)) {
    return false;
  }
  if (resolvedTarget === 'human') {
    return metadata.escalation_awaiting_human === true;
  }
  return typeof metadata.escalation_task_id === 'string' && metadata.escalation_task_id.length > 0;
}

export function hasMatchingAgentEscalationDepthFailure(
  task: Record<string, unknown>,
  currentDepth: number,
  maxDepth: number,
): boolean {
  const metadata = asRecord(task.metadata);
  const error = asRecord(task.error);
  return task.state === 'failed'
    && error.category === 'escalation_depth_exceeded'
    && (metadata.escalation_depth ?? null) === currentDepth
    && (metadata.escalation_max_depth ?? null) === maxDepth;
}

export function hasMatchingAssessmentRejection(
  task: Record<string, unknown>,
  feedback: string,
): boolean {
  const error = asRecord(task.error);
  return (
    task.state === 'failed'
    && matchesReviewMetadata(task, { action: 'reject', feedback })
    && error.category === 'assessment_rejected'
    && error.message === feedback
  );
}

export function isCancelledOrCompletedTask(task: Record<string, unknown>): boolean {
  return task.state === 'cancelled' || task.state === 'completed';
}
