import type { DashboardToolTagRecord } from '../../lib/api.js';

export interface RoleExecutionEnvironmentSummary {
  id: string;
  name: string;
  source_kind: 'catalog' | 'custom';
  catalog_key?: string | null;
  catalog_version?: number | null;
  image: string;
  cpu: string;
  memory: string;
  pull_policy: 'always' | 'if-not-present' | 'never';
  compatibility_status: 'unknown' | 'compatible' | 'incompatible';
  support_status?: 'active' | 'deprecated' | 'blocked' | null;
  is_archived?: boolean;
  verification_contract_version?: string | null;
  verified_metadata?: Record<string, unknown>;
  tool_capabilities?: Record<string, unknown>;
  bootstrap_commands?: string[];
  bootstrap_required_domains?: string[];
  agent_hint?: string;
}

export interface RoleDefinition {
  id: string;
  name: string;
  description?: string | null;
  system_prompt?: string | null;
  allowed_tools?: string[];
  model_preference?: string | null;
  verification_strategy?: string | null;
  escalation_target?: string | null;
  max_escalation_depth?: number | null;
  execution_environment_id?: string | null;
  execution_environment?: RoleExecutionEnvironmentSummary | null;
  is_active?: boolean;
  version?: number;
  updated_at?: string | null;
}

export interface RoleFormState {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  isActive: boolean;
  executionEnvironmentId: string;
}

export interface LlmProviderRecord {
  id: string;
  name: string;
}

export interface ReasoningConfigSchema {
  type: 'reasoning_effort' | 'effort' | 'thinking_level' | 'thinking_budget';
  options?: string[];
  min?: number;
  max?: number;
  default: string | number;
}

export interface NativeSearchCapability {
  mode: 'openai_web_search' | 'anthropic_web_search_20250305' | 'google_search';
  defaultEnabled: boolean;
}

export interface LlmModelRecord {
  id: string;
  model_id: string;
  provider_id?: string | null;
  provider_name?: string | null;
  reasoning_config?: ReasoningConfigSchema | null;
  native_search?: NativeSearchCapability | null;
  is_enabled?: boolean;
}

export interface RoleModelOption {
  value: string;
  label: string;
  providerName: string;
  source: 'catalog' | 'existing';
}

export interface RoleToolCatalogEntry extends DashboardToolTagRecord {
  owner?: 'runtime' | 'task';
}

export const NATIVE_SEARCH_TOOL = 'native_search';

export function createRoleForm(
  role?: RoleDefinition | null,
  defaultToolIds: string[] = [],
): RoleFormState {
  return {
    name: role?.name ?? '',
    description: role?.description ?? '',
    systemPrompt: role?.system_prompt ?? '',
    allowedTools: role?.allowed_tools ?? [...defaultToolIds],
    isActive: role?.is_active ?? true,
    executionEnvironmentId: role?.execution_environment_id ?? '',
  };
}

export function createDuplicateRoleForm(
  source: RoleDefinition,
  defaultToolIds: string[] = [],
): RoleFormState {
  const form = createRoleForm(source, defaultToolIds);
  form.name = '';
  return form;
}

export function buildRolePayload(form: RoleFormState) {
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    systemPrompt: form.systemPrompt.trim() || undefined,
    allowedTools: normalizeStringList(form.allowedTools),
    executionEnvironmentId: normalizeExecutionEnvironmentId(form.executionEnvironmentId),
    isActive: form.isActive,
  };
}

export function listAvailableTools(
  toolCatalog: RoleToolCatalogEntry[],
  role?: RoleDefinition | null,
  model?: LlmModelRecord | null,
) {
  const catalogEntries = toolCatalog.filter(
    (tool) =>
      isSpecialistSelectableTool(tool)
      && (tool.id !== NATIVE_SEARCH_TOOL || supportsNativeSearch(model)),
  );
  const storedTools = (role?.allowed_tools ?? []).filter((toolId) => {
    if (toolId === NATIVE_SEARCH_TOOL && !supportsNativeSearch(model)) {
      return false;
    }
    const catalogTool = toolCatalog.find((tool) => tool.id === toolId);
    return catalogTool ? isSpecialistSelectableTool(catalogTool) : true;
  });
  const toolsById = new Map<string, RoleToolCatalogEntry>();

  for (const tool of catalogEntries) {
    toolsById.set(tool.id, tool);
  }

  for (const toolId of storedTools) {
    if (!toolsById.has(toolId)) {
      toolsById.set(toolId, {
        id: toolId,
        name: toolId,
      });
    }
  }

  if (supportsNativeSearch(model) && !toolsById.has(NATIVE_SEARCH_TOOL)) {
    toolsById.set(NATIVE_SEARCH_TOOL, {
      id: NATIVE_SEARCH_TOOL,
      name: NATIVE_SEARCH_TOOL,
      owner: 'runtime',
      category: 'search',
      is_built_in: true,
    });
  }

  return [...toolsById.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function resolveEffectiveRoleModel(
  models: LlmModelRecord[],
  selectedModelId: string | null | undefined,
  systemDefaultModelId: string | null | undefined,
): LlmModelRecord | null {
  const modelId = selectedModelId?.trim() || systemDefaultModelId?.trim() || '';
  if (!modelId) {
    return null;
  }
  return models.find((model) => model.id === modelId) ?? null;
}

export function syncNativeSearchGrant(
  form: RoleFormState,
  model: LlmModelRecord | null,
  options: { enableByDefault: boolean },
): RoleFormState {
  const supportsSearch = supportsNativeSearch(model);
  const nextAllowedTools = form.allowedTools.filter((tool) => tool !== NATIVE_SEARCH_TOOL);

  if (supportsSearch && (options.enableByDefault || form.allowedTools.includes(NATIVE_SEARCH_TOOL))) {
    nextAllowedTools.push(NATIVE_SEARCH_TOOL);
  }

  return {
    ...form,
    allowedTools: normalizeStringList(nextAllowedTools),
  };
}

export function buildRoleModelOptions(
  models: LlmModelRecord[],
  providers: LlmProviderRecord[],
  role?: RoleDefinition | null,
): RoleModelOption[] {
  const providerNames = new Map(providers.map((provider) => [provider.id, provider.name] as const));
  const options = new Map<string, RoleModelOption>();

  for (const model of models.filter((item) => item.is_enabled !== false)) {
    const providerName =
      model.provider_name ?? (model.provider_id ? providerNames.get(model.provider_id) : null) ?? 'Unknown provider';
    options.set(model.model_id, {
      value: model.model_id,
      label: `${providerName} / ${model.model_id}`,
      providerName,
      source: 'catalog',
    });
  }

  for (const existing of [role?.model_preference]) {
    const value = existing?.trim();
    if (value && !options.has(value)) {
      options.set(value, {
        value,
        label: `${value} (existing selection)`,
        providerName: 'Existing selection',
        source: 'existing',
      });
    }
  }

  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function countRoleStateSummary(roles: RoleDefinition[]) {
  return roles.reduce(
    (summary, role) => ({
      total: summary.total + 1,
      active: summary.active + (role.is_active === false ? 0 : 1),
      inactive: summary.inactive + (role.is_active === false ? 1 : 0),
    }),
    { total: 0, active: 0, inactive: 0 },
  );
}

export function isSelectableExecutionEnvironment(
  environment: RoleExecutionEnvironmentSummary,
): boolean {
  return (
    environment.compatibility_status === 'compatible'
    && environment.support_status !== 'blocked'
    && environment.is_archived !== true
  );
}

export function buildRoleExecutionEnvironmentOptions(
  environments: RoleExecutionEnvironmentSummary[],
  selectedEnvironmentId: string,
  selectedEnvironment?: RoleExecutionEnvironmentSummary | null,
): RoleExecutionEnvironmentSummary[] {
  const selectableEnvironments = environments.filter(isSelectableExecutionEnvironment);
  const normalizedSelectedId = selectedEnvironmentId.trim();
  if (normalizedSelectedId === '') {
    return selectableEnvironments;
  }

  const selectedOption =
    environments.find((environment) => environment.id === normalizedSelectedId)
    ?? selectedEnvironment
    ?? null;
  if (!selectedOption) {
    return selectableEnvironments;
  }
  if (selectableEnvironments.some((environment) => environment.id === selectedOption.id)) {
    return selectableEnvironments;
  }
  return [...selectableEnvironments, selectedOption];
}

export function formatRoleDeleteError(error: unknown): string | null {
  if (!error) {
    return null;
  }

  const message = (error instanceof Error ? error.message : String(error ?? '')).trim();
  const playbookMatch = message.match(/used by playbook:\s*(.+?)(?:[.]?$)/i);
  if (playbookMatch) {
    return `This specialist is still used by playbook "${playbookMatch[1]}". Update that playbook before deleting the specialist.`;
  }

  const normalized = message.replace(/^HTTP\s+\d+:\s*/i, '').trim();
  return normalized || 'Failed to delete specialist.';
}

function normalizeExecutionEnvironmentId(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isSpecialistSelectableTool(tool: RoleToolCatalogEntry): boolean {
  return tool.access_scope !== 'orchestrator_only';
}

function supportsNativeSearch(model: LlmModelRecord | null | undefined): boolean {
  return Boolean(model?.native_search);
}
