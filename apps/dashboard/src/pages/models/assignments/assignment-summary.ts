import type { AssignmentSurfaceSummaryCard } from '../models-page.support.js';
import {
  summarizeAssignmentSurface,
  validateAssignmentSetup,
} from '../models-page.support.js';
import { buildAssignmentRoleRows } from '../models-page.defaults.js';
import type {
  LlmModel,
  RoleAssignment,
  RoleDefinitionSummary,
  SystemDefault,
} from '../models-page.types.js';

export function buildAssignmentSummaryCards(input: {
  enabledModels: LlmModel[];
  assignments: RoleAssignment[];
  roleDefinitions: RoleDefinitionSummary[];
  systemDefault: SystemDefault;
}): AssignmentSurfaceSummaryCard[] {
  const roleRows = buildAssignmentRoleRows(input.roleDefinitions, input.assignments);
  const missingAssignmentCount = roleRows.filter((role) => role.source === 'assignment').length;
  const inactiveRoleCount = roleRows.filter(
    (role) => role.source === 'catalog' && role.isActive === false,
  ).length;
  const explicitOverrideCount = roleRows.filter((role) => {
    const assignment = input.assignments.find((entry) => entry.role_name === role.name);
    return assignment?.primary_model_id != null || assignment?.reasoning_config != null;
  }).length;
  const assignmentValidation = validateAssignmentSetup({
    defaultModelId: input.systemDefault.modelId ?? '__none__',
    roleAssignments: roleRows.map((role) => ({
      roleName: role.name,
      modelId:
        input.assignments.find((entry) => entry.role_name === role.name)?.primary_model_id ??
        '__none__',
    })),
  });

  return summarizeAssignmentSurface({
    enabledModelCount: input.enabledModels.length,
    defaultModelConfigured: input.systemDefault.modelId != null,
    roleCount: roleRows.length,
    explicitOverrideCount,
    staleRoleCount: missingAssignmentCount,
    inactiveRoleCount,
    missingAssignmentCount,
    blockingIssues: assignmentValidation.blockingIssues,
  }).cards;
}
