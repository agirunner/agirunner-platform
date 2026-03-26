import type {
  DashboardPlaybookRecord,
  DashboardRoleModelOverride,
  DashboardWorkflowBudgetInput,
} from '../../lib/api.js';

export type StructuredValueType = 'string' | 'number' | 'boolean' | 'json';

export interface LaunchParameterSpec {
  slug: string;
  title: string;
  required: boolean;
}

export interface LaunchDefinitionSummary {
  roles: string[];
  stageNames: string[];
  boardColumns: Array<{ id: string; label: string }>;
  parameterSpecs: LaunchParameterSpec[];
}

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

export interface WorkflowBudgetDraft {
  tokenBudget: string;
  costCapUsd: string;
  maxDurationMinutes: string;
}

export type WorkflowBudgetMode = 'open-ended' | 'guarded';

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

export function readLaunchDefinition(
  playbook: DashboardPlaybookRecord | null,
): LaunchDefinitionSummary {
  const definition = asRecord(playbook?.definition);
  return {
    roles: readStringArray(definition.roles),
    stageNames: readStageNames(definition),
    boardColumns: readBoardColumns(definition.board),
    parameterSpecs: readParameterSpecs(definition.parameters),
  };
}

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

export function createWorkflowBudgetDraft(): WorkflowBudgetDraft {
  return {
    tokenBudget: '',
    costCapUsd: '',
    maxDurationMinutes: '',
  };
}

export function clearWorkflowBudgetDraft(): WorkflowBudgetDraft {
  return createWorkflowBudgetDraft();
}

export function readWorkflowBudgetMode(draft: WorkflowBudgetDraft): WorkflowBudgetMode {
  return hasWorkflowBudgetGuardrails(draft) ? 'guarded' : 'open-ended';
}

export function buildWorkflowBudgetInput(
  draft: WorkflowBudgetDraft,
): DashboardWorkflowBudgetInput | undefined {
  const tokenBudget = parsePositiveInteger(draft.tokenBudget, 'Token budget');
  const costCapUsd = parsePositiveNumber(draft.costCapUsd, 'Cost cap');
  const maxDurationMinutes = parsePositiveInteger(draft.maxDurationMinutes, 'Maximum duration');

  const value: DashboardWorkflowBudgetInput = {};
  if (tokenBudget !== undefined) {
    value.token_budget = tokenBudget;
  }
  if (costCapUsd !== undefined) {
    value.cost_cap_usd = costCapUsd;
  }
  if (maxDurationMinutes !== undefined) {
    value.max_duration_minutes = maxDurationMinutes;
  }
  return Object.keys(value).length > 0 ? value : undefined;
}

export function validateLaunchDraft(input: {
  selectedPlaybook: DashboardPlaybookRecord | null;
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

export function summarizeWorkflowBudgetDraft(draft: WorkflowBudgetDraft): string {
  const parts: string[] = [];
  if (draft.tokenBudget.trim()) {
    parts.push(`${draft.tokenBudget.trim()} tokens`);
  }
  if (draft.costCapUsd.trim()) {
    parts.push(`$${draft.costCapUsd.trim()} cost cap`);
  }
  if (draft.maxDurationMinutes.trim()) {
    parts.push(`${draft.maxDurationMinutes.trim()} minutes`);
  }
  return parts.length > 0
    ? `Workflow guardrails set for ${parts.join(', ')}.`
    : 'No explicit budget guardrails; the workflow will use open-ended defaults.';
}

function readRequiredParameterError(
  specs: LaunchParameterSpec[],
  drafts: Record<string, string>,
): string | undefined {
  const missingRequired = specs.find(
    (spec) => spec.required && (drafts[spec.slug]?.trim().length ?? 0) === 0,
  );
  return missingRequired
    ? `Enter a value for required launch input '${missingRequired.title}'.`
    : undefined;
}

function readParameterSpecs(value: unknown): LaunchParameterSpec[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => readParameterSpec(entry))
    .filter((entry): entry is LaunchParameterSpec => entry !== null);
}

function readParameterSpec(value: unknown): LaunchParameterSpec | null {
  const record = asRecord(value);
  const slug = readNonEmptyString(record.slug);
  const title = readNonEmptyString(record.title);
  if (!slug || !title) {
    return null;
  }
  return {
    slug,
    title,
    required: record.required === true,
  };
}

function readStageNames(definition: Record<string, unknown>): string[] {
  return readNamedFlowEntries(definition.stages);
}

function readNamedFlowEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => readNonEmptyString(asRecord(entry).name))
    .filter((entry): entry is string => Boolean(entry));
}

function readBoardColumns(value: unknown): Array<{ id: string; label: string }> {
  const board = asRecord(value);
  const columns = Array.isArray(board.columns) ? board.columns : [];
  return columns
    .map((entry) => {
      const record = asRecord(entry);
      const id = readNonEmptyString(record.id);
      if (!id) {
        return null;
      }
      return {
        id,
        label: readNonEmptyString(record.label) ?? id,
      };
    })
    .filter((entry): entry is { id: string; label: string } => entry !== null);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
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

function parsePositiveInteger(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  return parsed;
}

function parsePositiveNumber(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function hasWorkflowBudgetGuardrails(draft: WorkflowBudgetDraft): boolean {
  return (
    draft.tokenBudget.trim().length > 0 ||
    draft.costCapUsd.trim().length > 0 ||
    draft.maxDurationMinutes.trim().length > 0
  );
}

function validateWorkflowBudgetDraft(
  draft: WorkflowBudgetDraft,
): Pick<
  LaunchValidationResult['fieldErrors'],
  'tokenBudget' | 'costCapUsd' | 'maxDurationMinutes'
> {
  return {
    tokenBudget: readBudgetFieldError(draft.tokenBudget, 'Token budget', parsePositiveInteger),
    costCapUsd: readBudgetFieldError(draft.costCapUsd, 'Cost cap', parsePositiveNumber),
    maxDurationMinutes: readBudgetFieldError(
      draft.maxDurationMinutes,
      'Maximum duration',
      parsePositiveInteger,
    ),
  };
}

function readBudgetFieldError(
  value: string,
  label: string,
  parser: (raw: string, fieldLabel: string) => number | undefined,
): string | undefined {
  try {
    parser(value, label);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : `${label} is invalid.`;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function nextDraftId(prefix: string): string {
  draftCounter += 1;
  return `${prefix}-${draftCounter}`;
}
