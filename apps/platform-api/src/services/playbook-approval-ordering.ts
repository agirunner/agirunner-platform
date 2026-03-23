import type { PlaybookDefinition } from '../orchestration/playbook-model.js';

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
  if (!checkpointName) {
    return false;
  }

  return definition.approval_rules.some((rule) =>
    rule.required !== false
    && rule.on === 'checkpoint'
    && rule.checkpoint === checkpointName
    && rule.ordering_policy?.approval_before_assessment === true);
}

export function resolveApprovalRetentionPolicy(
  definition: PlaybookDefinition,
  checkpointName: string | null,
): ApprovalRetentionPolicy | null {
  if (!checkpointName) {
    return null;
  }

  const rule = definition.approval_rules.find((candidate) =>
    candidate.on === 'checkpoint'
    && candidate.checkpoint === checkpointName,
  );
  if (!rule) {
    return null;
  }

  return {
    approval_retention: rule.revision_policy?.approval_retention ?? 'invalidate_all',
    required: rule.required ?? true,
    materiality: rule.materiality ?? 'material',
  };
}

export function resolveAssessmentExpectation(
  definition: PlaybookDefinition,
  subjectRole: string | null,
  checkpointName: string | null,
): AssessmentExpectation | null {
  if (!subjectRole || !checkpointName) {
    return null;
  }

  const requiredRules = definition.assessment_rules.filter((rule) =>
    rule.subject_role === subjectRole
    && (rule.checkpoint ?? checkpointName) === checkpointName
    && coerceRuleRequired(rule.required, rule.optional));
  if (requiredRules.length === 0) {
    return null;
  }

  const requiredAssessorRoles = Array.from(
    new Set(
      requiredRules
        .map((rule) => rule.assessed_by.trim())
        .filter((role) => role.length > 0),
    ),
  );
  if (requiredAssessorRoles.length === 0) {
    return null;
  }

  return {
    nextExpectedActor: requiredAssessorRoles.length === 1 ? requiredAssessorRoles[0] : null,
    requiredAssessorRoles,
  };
}

function coerceRuleRequired(required: boolean | undefined, optional: boolean | undefined) {
  if (typeof required === 'boolean') {
    return required;
  }
  return optional === true ? false : true;
}
