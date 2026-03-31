import type { DashboardRoleModelOverride } from '../../lib/api.js';

import {
  validateWorkflowBudgetDraft,
  type WorkflowBudgetDraft,
} from './playbook-launch-budget.js';
import {
  readRequiredParameterError,
  type LaunchParameterSpec,
} from './playbook-launch-definition.js';

export {
  buildWorkflowBudgetInput,
  clearWorkflowBudgetDraft,
  createWorkflowBudgetDraft,
  readWorkflowBudgetMode,
  summarizeWorkflowBudgetDraft,
  type WorkflowBudgetDraft,
  type WorkflowBudgetMode,
} from './playbook-launch-budget.js';
export {
  readLaunchDefinition,
  type LaunchDefinitionSummary,
  type LaunchParameterSpec,
} from './playbook-launch-definition.js';

export type StructuredValueType = 'string' | 'number' | 'boolean' | 'json';

export interface StructuredEntryDraft {
  id: string;
  key: string;
  valueType: StructuredValueType;
  value: string;
}

export interface RoleOverrideDraft {
  id: string;
  role: string;
  provider: string;
  model: string;
  reasoningEntries: StructuredEntryDraft[];
}

export interface LaunchValidationResult {
  fieldErrors: {
    playbook?: string;
    workflowName?: string;
    parameters?: string;
    tokenBudget?: string;
    costCapUsd?: string;
    maxDurationMinutes?: string;
    metadata?: string;
    workflowConfigOverrides?: string;
    workflowOverrides?: string;
  };
  blockingIssues: string[];
  isValid: boolean;
}

let draftCounter = 0;

export function buildParametersFromDrafts(
  specs: LaunchParameterSpec[],
  drafts: Record<string, string>,
): Record<string, string> | undefined {
  const parameters: Record<string, string> = {};

  for (const spec of specs) {
    const value = drafts[spec.slug]?.trim() ?? '';
    if (!value) {
      continue;
    }
    parameters[spec.slug] = value;
  }

  return Object.keys(parameters).length > 0 ? parameters : undefined;
}

export function buildStructuredObject(
  drafts: StructuredEntryDraft[],
  label: string,
): Record<string, unknown> | undefined {
  const value: Record<string, unknown> = {};

  for (const draft of drafts) {
    const key = draft.key.trim();
    if (!key) {
      if (draft.value.trim() === '') {
        continue;
      }
      throw new Error(`${label} keys are required.`);
    }
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`${label} contains a duplicate key '${key}'.`);
    }
    const parsed = parseDraftValue(draft.value, draft.valueType, `${label} '${key}'`);
    if (parsed === undefined) {
      throw new Error(`${label} '${key}' must include a value.`);
    }
    value[key] = parsed;
  }

  return Object.keys(value).length > 0 ? value : undefined;
}

export function buildModelOverrides(
  drafts: RoleOverrideDraft[],
): Record<string, DashboardRoleModelOverride> | undefined {
  const overrides: Record<string, DashboardRoleModelOverride> = {};

  for (const draft of drafts) {
    const role = draft.role.trim();
    const provider = draft.provider.trim();
    const model = draft.model.trim();
    const reasoningEntries = draft.reasoningEntries.filter(
      (entry) => entry.key.trim().length > 0 || entry.value.trim().length > 0,
    );

    if (!role && !provider && !model && reasoningEntries.length === 0) {
      continue;
    }
    if (!role) {
      throw new Error('Workflow model override roles are required.');
    }
    if (Object.prototype.hasOwnProperty.call(overrides, role)) {
      throw new Error(`Workflow model overrides contains a duplicate role '${role}'.`);
    }
    if (!provider || !model) {
      throw new Error(`Workflow model override '${role}' must include both provider and model.`);
    }

    const reasoningConfig =
      reasoningEntries.length > 0
        ? buildStructuredObject(reasoningEntries, `Workflow model override '${role}' reasoning`)
        : undefined;

    overrides[role] = {
      provider,
      model,
      ...(reasoningConfig ? { reasoning_config: reasoningConfig } : {}),
    };
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export function createStructuredEntryDraft(): StructuredEntryDraft {
  return {
    id: nextDraftId('entry'),
    key: '',
    valueType: 'string',
    value: '',
  };
}

export function createRoleOverrideDraft(role = ''): RoleOverrideDraft {
  return {
    id: nextDraftId('role'),
    role,
    provider: '',
    model: '',
    reasoningEntries: [],
  };
}

export function syncRoleOverrideDrafts(
  roles: string[],
  current: RoleOverrideDraft[],
): RoleOverrideDraft[] {
  const byRole = new Map(current.map((entry) => [entry.role.trim(), entry] as const));
  const ordered = roles.map((role) => byRole.get(role) ?? createRoleOverrideDraft(role));
  const custom = current.filter((entry) => {
    const role = entry.role.trim();
    return role.length === 0 || !roles.includes(role);
  });
  return [...ordered, ...custom];
}

export function validateLaunchDraft(input: {
  selectedPlaybook: { is_active?: boolean } | null;
  workflowName: string;
  workflowBudgetDraft: WorkflowBudgetDraft;
  parameterSpecs: LaunchParameterSpec[];
  parameterDrafts: Record<string, string>;
  metadataError?: string;
  workflowConfigOverridesError?: string;
  workflowOverrideError?: string;
}): LaunchValidationResult {
  const fieldErrors: LaunchValidationResult['fieldErrors'] = {
    ...validateWorkflowBudgetDraft(input.workflowBudgetDraft),
  };

  if (!input.selectedPlaybook) {
    fieldErrors.playbook = 'Select a playbook before launching a run.';
  } else if (input.selectedPlaybook.is_active === false) {
    fieldErrors.playbook =
      'Inactive playbooks must be reactivated from the detail page before launch.';
  }

  if (!input.workflowName.trim()) {
    fieldErrors.workflowName = 'Workflow name is required before launch.';
  }

  fieldErrors.parameters = readRequiredParameterError(
    input.parameterSpecs,
    input.parameterDrafts,
  );

  if (input.metadataError) {
    fieldErrors.metadata = input.metadataError;
  }

  if (input.workflowConfigOverridesError) {
    fieldErrors.workflowConfigOverrides = input.workflowConfigOverridesError;
  }

  if (input.workflowOverrideError) {
    fieldErrors.workflowOverrides = input.workflowOverrideError;
  }

  const blockingIssues = Object.values(fieldErrors).filter((issue): issue is string =>
    Boolean(issue),
  );

  return {
    fieldErrors,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}

function parseDraftValue(
  rawValue: string,
  valueType: StructuredValueType,
  label: string,
): unknown {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }
  if (valueType === 'number') {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${label} must be a valid number.`);
    }
    return parsed;
  }
  if (valueType === 'boolean') {
    if (trimmed !== 'true' && trimmed !== 'false') {
      throw new Error(`${label} must be true or false.`);
    }
    return trimmed === 'true';
  }
  if (valueType === 'json') {
    return parseJsonValue(trimmed, label);
  }
  return rawValue;
}

function parseJsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(
      `${label} must be valid JSON: ${error instanceof Error ? error.message : 'parse error'}`,
    );
  }
}

function nextDraftId(prefix: string): string {
  draftCounter += 1;
  return `${prefix}-${draftCounter}`;
}
