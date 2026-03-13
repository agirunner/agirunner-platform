import type { RoleDefinition, RoleFormState } from './role-definitions-page.support.js';

export interface EscalationTargetOption {
  value: string;
  label: string;
  description: string;
}

export interface RoleDialogValidation {
  fieldErrors: {
    name?: string;
    modelPreference?: string;
    fallbackModel?: string;
    escalationTarget?: string;
    maxEscalationDepth?: string;
  };
  blockingIssues: string[];
  advisoryIssues: string[];
  isValid: boolean;
}

export interface RoleSetupSummary {
  capabilitySummary: string;
  toolSummary: string;
  modelSummary: string;
  reviewSummary: string;
  escalationSummary: string;
}

export function readCustomCapabilityError(
  draft: string,
  existingCapabilities: string[],
): string | undefined {
  return readCustomRoleListError(
    draft,
    existingCapabilities,
    'Enter a custom capability before adding it.',
    'This capability is already added.',
    'Use an ID-style capability without spaces, for example role:data-scientist.',
  );
}

export function readCustomToolError(
  draft: string,
  existingTools: string[],
): string | undefined {
  return readCustomRoleListError(
    draft,
    existingTools,
    'Enter a custom tool grant before adding it.',
    'This tool grant is already added.',
    'Use a single tool ID without spaces, for example artifact_read.',
  );
}

export function buildEscalationTargetOptions(
  roles: RoleDefinition[],
  currentRole?: RoleDefinition | null,
): EscalationTargetOption[] {
  const currentName = currentRole?.name?.trim().toLowerCase() ?? '';
  const options: EscalationTargetOption[] = [
    {
      value: '__none__',
      label: 'No escalation',
      description: 'Keep the role self-contained and require no downstream handoff.',
    },
    {
      value: 'human',
      label: 'Human operator',
      description: 'Escalate to a person for review, approval, or intervention.',
    },
    ...roles
      .filter((role) => role.name.trim().toLowerCase() !== currentName)
      .map((role) => ({
        value: role.name,
        label: role.name,
        description: role.description?.trim() || 'Escalate into another specialist role.',
      })),
  ];

  const existingTarget = currentRole?.escalation_target?.trim();
  if (!existingTarget || existingTarget === 'human') {
    return options;
  }
  if (options.some((option) => option.value === existingTarget)) {
    return options;
  }
  return [
    ...options,
    {
      value: existingTarget,
      label: `${existingTarget} (existing target)`,
      description: 'Preserved from the stored role definition until you choose a replacement.',
    },
  ];
}

export function validateRoleDialog(
  form: RoleFormState,
  roles: RoleDefinition[],
  currentRole?: RoleDefinition | null,
): RoleDialogValidation {
  const fieldErrors = buildFieldErrors(form, roles, currentRole);
  const blockingIssues = Object.values(fieldErrors);
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
    capabilitySummary: summarizeCount(form.capabilities.length, 'capability'),
    toolSummary: summarizeCount(form.allowedTools.length, 'tool grant'),
    modelSummary: form.modelPreference
      ? `${form.modelPreference}${form.fallbackModel ? ` with ${form.fallbackModel} fallback` : ''}`
      : 'System default model routing',
    reviewSummary: describeVerificationStrategy(form.verificationStrategy),
    escalationSummary: form.escalationTarget
      ? form.escalationTarget === 'human'
        ? `Escalates to a human operator after ${form.maxEscalationDepth} handoff${form.maxEscalationDepth === 1 ? '' : 's'}`
        : `Escalates to ${form.escalationTarget} after ${form.maxEscalationDepth} handoff${form.maxEscalationDepth === 1 ? '' : 's'}`
      : 'No escalation target configured',
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

  if (!form.modelPreference && form.fallbackModel) {
    errors.modelPreference = 'Choose a preferred model before setting a fallback.';
  }
  if (form.modelPreference && form.modelPreference === form.fallbackModel) {
    errors.fallbackModel = 'Choose a fallback model that differs from the preferred model.';
  }
  if (!form.escalationTarget && form.maxEscalationDepth !== 5) {
    errors.escalationTarget = 'Choose an escalation target before changing escalation depth.';
  }
  if (form.escalationTarget && (form.maxEscalationDepth < 1 || form.maxEscalationDepth > 10)) {
    errors.maxEscalationDepth = 'Keep escalation depth between 1 and 10.';
  }
  return errors;
}

function buildAdvisoryIssues(form: RoleFormState): string[] {
  const issues: string[] = [];
  if (!form.systemPrompt.trim()) {
    issues.push('Add a system prompt so operators and orchestrators can understand how the role should behave.');
  }
  if (form.capabilities.length === 0) {
    issues.push('Add at least one capability so routing and staffing summaries stay meaningful.');
  }
  if (form.allowedTools.length === 0) {
    issues.push('Add at least one tool grant or confirm that this role should stay read-only.');
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

function summarizeCount(count: number, noun: string): string {
  const plural = noun === 'capability' ? 'capabilities' : `${noun}s`;
  return `${count} ${count === 1 ? noun : plural} selected`;
}

function describeVerificationStrategy(strategy: string): string {
  if (strategy === 'peer_review') {
    return 'Peer review required';
  }
  if (strategy === 'human_approval') {
    return 'Human approval required';
  }
  if (strategy === 'automated_test') {
    return 'Automated test verification';
  }
  if (strategy === 'unit_tests') {
    return 'Unit test verification';
  }
  if (strategy === 'structured_review') {
    return 'Structured review required';
  }
  return 'No verification requirement';
}

function readCustomRoleListError(
  draft: string,
  existingValues: string[],
  missingMessage: string,
  duplicateMessage: string,
  formatMessage: string,
): string | undefined {
  const trimmedDraft = draft.trim();
  if (!trimmedDraft) {
    return missingMessage;
  }
  if (/\s/.test(trimmedDraft)) {
    return formatMessage;
  }
  const normalizedDraft = trimmedDraft.toLowerCase();
  if (
    existingValues.some((value) => value.trim().toLowerCase() === normalizedDraft)
  ) {
    return duplicateMessage;
  }
  return undefined;
}
