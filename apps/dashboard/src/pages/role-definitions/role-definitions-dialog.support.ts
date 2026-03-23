import type { RoleDefinition, RoleFormState } from './role-definitions-page.support.js';
import {
  validateContainerCpu,
  validateContainerImage,
  validateContainerMemory,
} from '../../lib/container-resources.validation.js';

export interface RoleDialogValidation {
  fieldErrors: {
    name?: string;
    executionContainerImage?: string;
    executionContainerCpu?: string;
    executionContainerMemory?: string;
  };
  blockingIssues: string[];
  advisoryIssues: string[];
  isValid: boolean;
}

export interface RoleSetupSummary {
  toolSummary: string;
  modelSummary: string;
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

export function summarizeRoleSetup(form: RoleFormState): RoleSetupSummary {
  return {
    toolSummary: `${form.allowedTools.length} tool${form.allowedTools.length === 1 ? '' : 's'} enabled`,
    modelSummary: 'Model assigned via LLM Providers',
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
    errors.name = 'Enter a role name.';
  } else if (hasDuplicateRoleName(trimmedName, roles, currentRole)) {
    errors.name = 'Choose a unique role name.';
  }

  const imageError = validateContainerImage(form.executionContainer.image, 'Image', {
    emptyValueHint: 'Clear the field to inherit the system default image.',
  });
  if (imageError) {
    errors.executionContainerImage = imageError;
  }

  const cpuError = validateContainerCpu(form.executionContainer.cpu, 'CPU', {
    emptyValueHint: 'Clear the field to inherit the system default CPU allocation.',
  });
  if (cpuError) {
    errors.executionContainerCpu = cpuError;
  }

  const memoryError = validateContainerMemory(
    form.executionContainer.memory,
    'Memory',
    {
      emptyValueHint: 'Clear the field to inherit the system default memory allocation.',
    },
  );
  if (memoryError) {
    errors.executionContainerMemory = memoryError;
  }

  return errors;
}

function buildAdvisoryIssues(form: RoleFormState): string[] {
  const issues: string[] = [];
  if (!form.systemPrompt.trim()) {
    issues.push('Add a system prompt so the orchestrator understands how the role should behave.');
  }
  if (form.allowedTools.length === 0) {
    issues.push('Enable at least one tool or confirm that this role should be read-only.');
  }
  return issues;
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
