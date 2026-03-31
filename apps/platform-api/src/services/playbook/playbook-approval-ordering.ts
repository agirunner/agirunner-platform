import type { PlaybookDefinition } from '../../orchestration/playbook-model.js';

export interface AssessmentExpectation {
  nextExpectedActor: string | null;
  requiredAssessorRoles: string[];
}

export interface ApprovalRetentionPolicy {
  approval_retention?: 'invalidate_all' | 'retain_advisory_only' | 'retain_named_assessors' | 'retain_non_material_only';
  required?: boolean;
  materiality?: 'material' | 'non_material';
}

export function approvalBeforeAssessmentEnabled(
  definition: PlaybookDefinition,
  checkpointName: string | null,
) {
  void definition;
  void checkpointName;
  return false;
}

export function resolveApprovalRetentionPolicy(
  definition: PlaybookDefinition,
  checkpointName: string | null,
): ApprovalRetentionPolicy | null {
  void definition;
  void checkpointName;
  return null;
}

export function resolveAssessmentExpectation(
  definition: PlaybookDefinition,
  subjectRole: string | null,
  checkpointName: string | null,
): AssessmentExpectation | null {
  void definition;
  void subjectRole;
  void checkpointName;
  return null;
}
