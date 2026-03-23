import {
  PLATFORM_ORCHESTRATOR_SUBJECT_LINKAGE_INFERENCE_ID,
  mustGetSafetynetEntry,
} from './safetynet/registry.js';
import { logSafetynetTriggered } from './safetynet/logging.js';

export type WorkflowTaskKind = 'delivery' | 'assessment' | 'approval' | 'orchestrator';
export const SUBJECT_LINKAGE_INFERENCE_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_ORCHESTRATOR_SUBJECT_LINKAGE_INFERENCE_ID,
);

export interface AssessmentSubjectLinkage {
  subjectTaskId: string | null;
  subjectWorkItemId: string | null;
  subjectHandoffId: string | null;
  subjectRevision: number | null;
}

export function readWorkflowTaskKind(
  metadata: unknown,
  isOrchestratorTask = false,
): WorkflowTaskKind {
  const taskKind = readString(asRecord(metadata).task_kind);
  if (taskKind === 'assessment' || taskKind === 'approval' || taskKind === 'orchestrator' || taskKind === 'delivery') {
    return taskKind;
  }
  const taskType = readString(asRecord(metadata).task_type);
  if (taskType === 'assessment' || taskType === 'approval') {
    return taskType;
  }
  if (taskType === 'orchestration') {
    return 'orchestrator';
  }
  if (taskType === 'analysis' || taskType === 'code' || taskType === 'test' || taskType === 'docs' || taskType === 'custom') {
    return 'delivery';
  }
  if (isOrchestratorTask) {
    return 'orchestrator';
  }
  return 'delivery';
}

export function readAssessmentSubjectLinkage(
  input: unknown,
  metadata?: unknown,
): AssessmentSubjectLinkage {
  const source = asRecord(input);
  const meta = asRecord(metadata);
  return {
    subjectTaskId: readString(source.subject_task_id) ?? readString(meta.subject_task_id),
    subjectWorkItemId: readString(source.subject_work_item_id) ?? readString(meta.subject_work_item_id),
    subjectHandoffId: readString(source.subject_handoff_id) ?? readString(meta.subject_handoff_id),
    subjectRevision: readInteger(source.subject_revision) ?? readInteger(meta.subject_revision),
  };
}

export function hasExplicitAssessmentSubjectLinkage(
  input: unknown,
  metadata?: unknown,
): boolean {
  const linkage = readAssessmentSubjectLinkage(input, metadata);
  return Boolean(linkage.subjectTaskId || linkage.subjectWorkItemId || linkage.subjectHandoffId);
}

export function buildAssessmentSubjectInput(
  input: Record<string, unknown> | undefined,
  linkage: AssessmentSubjectLinkage,
): Record<string, unknown> {
  const nextInput = { ...(input ?? {}) };
  if (linkage.subjectTaskId) {
    nextInput.subject_task_id = linkage.subjectTaskId;
  }
  if (linkage.subjectWorkItemId) {
    nextInput.subject_work_item_id = linkage.subjectWorkItemId;
  }
  if (linkage.subjectHandoffId) {
    nextInput.subject_handoff_id = linkage.subjectHandoffId;
  }
  if (linkage.subjectRevision !== null) {
    nextInput.subject_revision = linkage.subjectRevision;
  }
  return nextInput;
}

export function buildAssessmentSubjectMetadata(
  metadata: Record<string, unknown> | undefined,
  linkage: AssessmentSubjectLinkage,
  source: string,
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    ...(linkage.subjectTaskId ? { subject_task_id: linkage.subjectTaskId } : {}),
    ...(linkage.subjectRevision !== null ? { subject_revision: linkage.subjectRevision } : {}),
    subject_linkage_source: source,
  };
}

export function mergeAssessmentSubjectLinkage(
  fallback: AssessmentSubjectLinkage,
  explicit: AssessmentSubjectLinkage,
): AssessmentSubjectLinkage {
  const merged = {
    subjectTaskId: explicit.subjectTaskId ?? fallback.subjectTaskId,
    subjectWorkItemId: explicit.subjectWorkItemId ?? fallback.subjectWorkItemId,
    subjectHandoffId: explicit.subjectHandoffId ?? fallback.subjectHandoffId,
    subjectRevision: explicit.subjectRevision ?? fallback.subjectRevision,
  };
  if (
    (!explicit.subjectTaskId && Boolean(fallback.subjectTaskId))
    || (!explicit.subjectWorkItemId && Boolean(fallback.subjectWorkItemId))
    || (!explicit.subjectHandoffId && Boolean(fallback.subjectHandoffId))
    || (explicit.subjectRevision === null && fallback.subjectRevision !== null)
  ) {
    logSafetynetTriggered(
      SUBJECT_LINKAGE_INFERENCE_SAFETYNET,
      'assessment subject linkage inferred from fallback context',
    );
  }
  return merged;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
