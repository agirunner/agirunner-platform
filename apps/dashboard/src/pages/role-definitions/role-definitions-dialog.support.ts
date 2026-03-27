import type {
  RoleDefinition,
  RoleExecutionEnvironmentSummary,
  RoleFormState,
} from './role-definitions-page.support.js';

export interface RoleDialogValidation {
  fieldErrors: {
    name?: string;
  };
  blockingIssues: string[];
  advisoryIssues: string[];
  isValid: boolean;
}

export interface RoleSetupSummary {
  toolSummary: string;
  modelSummary: string;
  environmentSummary: string;
  remoteMcpSummary: string;
  skillSummary: string;
}

export function validateRoleDialog(
  form: RoleFormState,
  roles: RoleDefinition[],
  currentRole?: RoleDefinition | null,
): RoleDialogValidation {
  const fieldErrors = buildFieldErrors(form, roles, currentRole);
  const blockingIssues = Object.values(fieldErrors).filter(Boolean) as string[];
  const advisoryIssues = buildAdvisoryIssues(form);
  return {
    fieldErrors,
    blockingIssues,
    advisoryIssues,
    isValid: blockingIssues.length === 0,
  };
}

export function summarizeRoleSetup(
  form: RoleFormState,
  selectedEnvironment?: RoleExecutionEnvironmentSummary | null,
): RoleSetupSummary {
  return {
    toolSummary: `${form.allowedTools.length} tool${form.allowedTools.length === 1 ? '' : 's'} enabled`,
    modelSummary: 'Model assigned on Models page',
    environmentSummary: summarizeEnvironmentSelection(form.executionEnvironmentId, selectedEnvironment),
    remoteMcpSummary: summarizeRemoteMcpSelection(form.mcpServerIds),
    skillSummary: summarizeSkillSelection(form.skillIds),
  };
}

function buildFieldErrors(
  form: RoleFormState,
  roles: RoleDefinition[],
  currentRole?: RoleDefinition | null,
): RoleDialogValidation['fieldErrors'] {
  const errors: RoleDialogValidation['fieldErrors'] = {};
  const trimmedName = form.name.trim();
  if (!trimmedName) {
    errors.name = 'Enter a specialist name.';
  } else if (hasDuplicateRoleName(trimmedName, roles, currentRole)) {
    errors.name = 'Choose a unique specialist name.';
  }
  return errors;
}

function buildAdvisoryIssues(form: RoleFormState): string[] {
  const issues: string[] = [];
  if (!form.systemPrompt.trim()) {
    issues.push('Add a system prompt so the orchestrator understands how the specialist should behave.');
  }
  if (form.allowedTools.length === 0) {
    issues.push('Enable at least one tool or confirm that this specialist should be read-only.');
  }
  return issues;
}

function summarizeEnvironmentSelection(
  environmentId: string,
  selectedEnvironment?: RoleExecutionEnvironmentSummary | null,
): string {
  if (!environmentId.trim()) {
    return 'Uses default environment';
  }
  if (!selectedEnvironment) {
    return 'Uses selected execution environment';
  }
  return `${selectedEnvironment.name} | ${selectedEnvironment.image}`;
}

function summarizeRemoteMcpSelection(serverIds: string[]): string {
  return `${serverIds.length} remote MCP server${serverIds.length === 1 ? '' : 's'} granted`;
}

function summarizeSkillSelection(skillIds: string[]): string {
  return `${skillIds.length} skill${skillIds.length === 1 ? '' : 's'} assigned`;
}

function hasDuplicateRoleName(
  trimmedName: string,
  roles: RoleDefinition[],
  currentRole?: RoleDefinition | null,
): boolean {
  const normalized = trimmedName.toLowerCase();
  return roles.some((role) => {
    if (role.id === currentRole?.id) {
      return false;
    }
    return role.name.trim().toLowerCase() === normalized;
  });
}
