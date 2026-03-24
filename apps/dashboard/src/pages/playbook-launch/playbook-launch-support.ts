import type {
  DashboardPlaybookRecord,
  DashboardWorkspaceRecord,
  DashboardRoleModelOverride,
  DashboardWorkflowBudgetInput,
} from '../../lib/api.js';

export type StructuredValueType = 'string' | 'number' | 'boolean' | 'json';

export interface LaunchParameterSpec {
  key: string;
  label: string;
  description: string;
  helpText: string;
  inputType: StructuredValueType | 'select';
  defaultValue?: unknown;
  options: string[];
  mapsTo?: string;
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
    tokenBudget?: string;
    costCapUsd?: string;
    maxDurationMinutes?: string;
    additionalParameters?: string;
    metadata?: string;
    workflowConfigOverrides?: string;
    workflowOverrides?: string;
  };
  blockingIssues: string[];
  isValid: boolean;
}

export interface LaunchParameterResolutionStep {
  key: 'playbook-default' | 'workspace-autofill' | 'launch-override';
  label: string;
  detail: string;
  value?: string;
  isActive: boolean;
}

export interface LaunchParameterResolutionState {
  badgeLabel: string;
  detail: string;
  activeSource: LaunchParameterResolutionStep['key'] | 'unset';
  steps: LaunchParameterResolutionStep[];
  canRestoreWorkspaceValue: boolean;
  canRestoreDefaultValue: boolean;
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
): Record<string, unknown> | undefined {
  const parameters: Record<string, unknown> = {};
  for (const spec of specs) {
    const rawValue =
      drafts[spec.key] ?? defaultParameterDraftValue(spec.defaultValue, spec.inputType);
    const normalized = parseDraftValue(rawValue, spec.inputType, `Parameter '${spec.label}'`);
    if (normalized !== undefined) {
      parameters[spec.key] = normalized;
    }
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

export function mergeStructuredObjects(
  base: Record<string, unknown> | undefined,
  extra: Record<string, unknown> | undefined,
  label: string,
): Record<string, unknown> | undefined {
  if (!base && !extra) {
    return undefined;
  }
  if (!base) {
    return extra;
  }
  if (!extra) {
    return base;
  }
  for (const key of Object.keys(extra)) {
    if (Object.prototype.hasOwnProperty.call(base, key)) {
      throw new Error(`${label} contains a duplicate key '${key}'.`);
    }
  }
  return { ...base, ...extra };
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

export function defaultParameterDraftValue(
  value: unknown,
  inputType: LaunchParameterSpec['inputType'],
): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (inputType === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (inputType === 'json') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
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

export function readMappedWorkspaceParameterDraft(
  spec: LaunchParameterSpec,
  workspace: DashboardWorkspaceRecord | null,
): string | undefined {
  const mappedValue = readMappedWorkspaceValue(workspace, spec.mapsTo);
  if (mappedValue === undefined) {
    return undefined;
  }
  return defaultParameterDraftValue(mappedValue, spec.inputType);
}

export function describeMappedWorkspacePath(mapsTo: string | undefined): string {
  const normalized = mapsTo?.trim().replace(/^workspace\./, '') ?? '';
  if (!normalized) {
    return 'workspace field';
  }
  return normalized
    .split('.')
    .filter(Boolean)
    .map((segment, index) => {
      const label = segment.replace(/_/g, ' ');
      if (index === 0) {
        return label;
      }
      return label;
    })
    .join(' → ');
}

export function describeLaunchParameterResolution(input: {
  spec: LaunchParameterSpec;
  workspace: DashboardWorkspaceRecord | null;
  currentValue: string;
}): LaunchParameterResolutionState {
  const hasWorkspaceMapping = Boolean(input.spec.mapsTo);
  const sourceLabel = describeMappedWorkspacePath(input.spec.mapsTo);
  const defaultValue = readParameterSourceValue(input.spec.defaultValue, input.spec.inputType);
  const mappedValue = readMappedWorkspaceParameterDraft(input.spec, input.workspace);
  const hasInheritedValue = Boolean(defaultValue) || mappedValue !== undefined;
  const hasCurrentValue = input.currentValue.trim().length > 0;

  let activeSource: LaunchParameterResolutionState['activeSource'] = 'unset';
  if (!hasCurrentValue && hasInheritedValue) {
    activeSource = 'launch-override';
  } else if (mappedValue !== undefined && input.currentValue === mappedValue) {
    activeSource = 'workspace-autofill';
  } else if (defaultValue !== undefined && input.currentValue === defaultValue) {
    activeSource = 'playbook-default';
  } else if (hasCurrentValue) {
    activeSource = 'launch-override';
  }

  const steps: LaunchParameterResolutionStep[] = [
    {
      key: 'playbook-default',
      label: 'Playbook default',
      detail: defaultValue
        ? 'Base value declared on the playbook.'
        : 'No playbook default is declared for this parameter.',
      value: defaultValue,
      isActive: activeSource === 'playbook-default',
    },
  ];

  if (input.spec.mapsTo) {
    steps.push({
      key: 'workspace-autofill',
      label: 'Workspace autofill',
      detail: readWorkspaceAutofillDetail({
        workspace: input.workspace,
        sourceLabel,
        mappedValue,
      }),
      value: mappedValue,
      isActive: activeSource === 'workspace-autofill',
    });
  }

  steps.push({
    key: 'launch-override',
    label: 'Launch override',
    detail: readLaunchOverrideDetail({
      activeSource,
      hasCurrentValue,
      hasInheritedValue,
      hasWorkspaceMapping,
      workspace: input.workspace,
      sourceLabel,
      hasPlaybookDefault: defaultValue !== undefined,
    }),
    value: activeSource === 'launch-override' && hasCurrentValue ? input.currentValue : undefined,
    isActive: activeSource === 'launch-override',
  });

  return {
    badgeLabel: readResolutionBadgeLabel(activeSource, hasCurrentValue),
    detail: readResolutionDetail({
      activeSource,
      workspace: input.workspace,
      sourceLabel,
      mappedValue,
      hasWorkspaceMapping,
      hasPlaybookDefault: defaultValue !== undefined,
      hasCurrentValue,
    }),
    activeSource,
    steps,
    canRestoreWorkspaceValue: mappedValue !== undefined && input.currentValue !== mappedValue,
    canRestoreDefaultValue: defaultValue !== undefined && input.currentValue !== defaultValue,
  };
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
  additionalParametersError?: string;
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
    fieldErrors.playbook = 'Inactive playbooks must be reactivated from the detail page before launch.';
  }

  if (!input.workflowName.trim()) {
    fieldErrors.workflowName = 'Workflow name is required before launch.';
  }

  if (input.additionalParametersError) {
    fieldErrors.additionalParameters = input.additionalParametersError;
  }

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
  const key =
    readNonEmptyString(record.name) ??
    readNonEmptyString(record.key) ??
    readNonEmptyString(record.id);
  if (!key) {
    return null;
  }
  const options = readOptions(record.options ?? record.choices ?? record.enum);
  const defaultValue = record.default ?? record.default_value ?? record.value;
  const inputType = inferInputType(record.type, options, defaultValue);
  return {
    key,
    label: readNonEmptyString(record.label) ?? readNonEmptyString(record.title) ?? key,
    description: readNonEmptyString(record.description) ?? readNonEmptyString(record.help) ?? '',
    helpText: readNonEmptyString(record.help_text) ?? readNonEmptyString(record.helpText) ?? '',
    inputType,
    defaultValue,
    options,
    mapsTo: readNonEmptyString(record.maps_to) ?? readNonEmptyString(record.mapsTo) ?? undefined,
  };
}

function inferInputType(
  rawType: unknown,
  options: string[],
  defaultValue: unknown,
): LaunchParameterSpec['inputType'] {
  const type = readNonEmptyString(rawType)?.toLowerCase();
  if (options.length > 0) {
    return 'select';
  }
  if (type === 'number' || type === 'integer') {
    return 'number';
  }
  if (type === 'boolean') {
    return 'boolean';
  }
  if (type === 'json' || type === 'object' || type === 'array') {
    return 'json';
  }
  if (typeof defaultValue === 'number') {
    return 'number';
  }
  if (typeof defaultValue === 'boolean') {
    return 'boolean';
  }
  if (defaultValue && typeof defaultValue === 'object') {
    return 'json';
  }
  return 'string';
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

function readOptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry.trim();
      }
      const record = asRecord(entry);
      return (
        readNonEmptyString(record.value) ??
        readNonEmptyString(record.id) ??
        readNonEmptyString(record.label) ??
        ''
      );
    })
    .filter((entry) => entry.length > 0);
}

function readParameterSourceValue(
  value: unknown,
  inputType: LaunchParameterSpec['inputType'],
): string | undefined {
  const draftValue = defaultParameterDraftValue(value, inputType);
  return draftValue === '' ? undefined : draftValue;
}

function readWorkspaceAutofillDetail(input: {
  workspace: DashboardWorkspaceRecord | null;
  sourceLabel: string;
  mappedValue: string | undefined;
}): string {
  if (!input.workspace) {
    return `Select a workspace to autofill from ${input.sourceLabel}.`;
  }
  if (input.mappedValue === undefined) {
    return `${input.workspace.name} does not currently provide ${input.sourceLabel}.`;
  }
  return `Mapped from ${input.workspace.name} → ${input.sourceLabel}.`;
}

function readLaunchOverrideDetail(input: {
  activeSource: LaunchParameterResolutionState['activeSource'];
  hasCurrentValue: boolean;
  hasInheritedValue: boolean;
  hasWorkspaceMapping: boolean;
  workspace: DashboardWorkspaceRecord | null;
  sourceLabel: string;
  hasPlaybookDefault: boolean;
}): string {
  if (input.activeSource !== 'launch-override') {
    return 'No launch override entered.';
  }
  if (!input.hasCurrentValue && input.hasInheritedValue) {
    return 'This run clears the inherited value until you restore a source below.';
  }
  if (input.workspace && input.hasWorkspaceMapping) {
    return `This run overrides ${input.workspace.name} → ${input.sourceLabel}.`;
  }
  if (input.hasPlaybookDefault) {
    return 'This run overrides the playbook default for this parameter.';
  }
  return 'This run supplies a launch-only value.';
}

function readResolutionBadgeLabel(
  activeSource: LaunchParameterResolutionState['activeSource'],
  hasCurrentValue: boolean,
): string {
  if (activeSource === 'playbook-default') {
    return 'Using playbook default';
  }
  if (activeSource === 'workspace-autofill') {
    return 'Using workspace autofill';
  }
  if (activeSource === 'launch-override') {
    return hasCurrentValue ? 'Launch override active' : 'Launch override clears inherited value';
  }
  return 'Awaiting launch value';
}

function readResolutionDetail(input: {
  activeSource: LaunchParameterResolutionState['activeSource'];
  workspace: DashboardWorkspaceRecord | null;
  sourceLabel: string;
  mappedValue: string | undefined;
  hasWorkspaceMapping: boolean;
  hasPlaybookDefault: boolean;
  hasCurrentValue: boolean;
}): string {
  if (input.activeSource === 'playbook-default') {
    if (!input.hasWorkspaceMapping) {
      return 'This run uses the playbook default until you override it at launch.';
    }
    if (input.workspace && input.hasWorkspaceMapping && input.mappedValue !== undefined) {
      return `This run stays pinned to the playbook default instead of ${input.workspace.name} autofill.`;
    }
    if (input.workspace && input.hasWorkspaceMapping && input.mappedValue === undefined) {
      return `${input.workspace.name} does not currently supply ${input.sourceLabel}, so the playbook default stays in effect.`;
    }
    return 'This run uses the playbook default until you attach workspace context or override it.';
  }
  if (input.activeSource === 'workspace-autofill' && input.workspace && input.hasWorkspaceMapping) {
    return `${input.workspace.name} supplies ${input.sourceLabel}, so this run inherits that value unless you override it at launch.`;
  }
  if (input.activeSource === 'launch-override') {
    if (!input.hasCurrentValue) {
      return 'This run clears the inherited value and will send nothing unless you restore a source.';
    }
    if (input.workspace && input.hasWorkspaceMapping && input.mappedValue !== undefined) {
      return `This run overrides the ${input.workspace.name} autofill for this parameter.`;
    }
    if (input.hasPlaybookDefault) {
      return 'This run overrides the playbook default for this parameter.';
    }
    return 'This run provides a launch-only value for this parameter.';
  }
  return 'No playbook default, workspace autofill, or launch override is active yet.';
}

function parseDraftValue(
  rawValue: string,
  valueType: StructuredValueType | 'select',
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

function parseJsonRecord(value: string, label: string): Record<string, unknown> {
  const parsed = parseJsonValue(value, label);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
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

function readMappedWorkspaceValue(
  workspace: DashboardWorkspaceRecord | null,
  mapsTo: string | undefined,
): unknown {
  if (!workspace || !mapsTo) {
    return undefined;
  }
  const normalized = mapsTo.trim().replace(/^workspace\./, '');
  if (!normalized) {
    return undefined;
  }
  let current: unknown = workspace;
  for (const segment of normalized.split('.')) {
    if (!segment) {
      return undefined;
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
