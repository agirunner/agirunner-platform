import type { PlaybookDefinition } from '../orchestration/playbook-model.js';

export interface AssessmentExpectation {
  nextExpectedActor: string | null;
  requiredAssessorRoles: string[];
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
