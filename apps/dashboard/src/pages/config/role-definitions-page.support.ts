export interface RoleDefinition {
  id: string;
  name: string;
  description?: string | null;
  system_prompt?: string | null;
  allowed_tools?: string[];
  capabilities?: string[];
  model_preference?: string | null;
  verification_strategy?: string | null;
  escalation_target?: string | null;
  max_escalation_depth?: number | null;
  execution_container_config?: {
    image?: string | null;
    cpu?: string | null;
    memory?: string | null;
    pull_policy?: 'always' | 'if-not-present' | 'never' | null;
  } | null;
  is_built_in?: boolean;
  is_active?: boolean;
  version?: number;
  updated_at?: string | null;
}

export interface RoleExecutionContainerFormState {
  image: string;
  cpu: string;
  memory: string;
  pullPolicy: string;
}

export interface RoleFormState {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  capabilities: string[];
  isActive: boolean;
  executionContainer: RoleExecutionContainerFormState;
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

export interface CapabilityOption {
  value: string;
  label: string;
  category: string;
  description: string;
}

export interface RoleModelOption {
  value: string;
  label: string;
  providerName: string;
  source: 'catalog' | 'existing';
}

const KNOWN_CAPABILITY_CATALOG: CapabilityOption[] = [
  {
    value: 'coding',
    label: 'Coding',
    category: 'Engineering',
    description: 'Writes, modifies, and refactors code.',
  },
  {
    value: 'code-review',
    label: 'Code review',
    category: 'Engineering',
    description: 'Reviews code for correctness, security, and standards.',
  },
  {
    value: 'architecture',
    label: 'Architecture',
    category: 'Engineering',
    description: 'System design, API contracts, and technical decisions.',
  },
  {
    value: 'testing',
    label: 'Testing',
    category: 'Quality',
    description: 'Writes and executes tests, verifies coverage.',
  },
  {
    value: 'security-review',
    label: 'Security review',
    category: 'Quality',
    description: 'Reviews for vulnerabilities, compliance, and secure coding.',
  },
  {
    value: 'documentation',
    label: 'Documentation',
    category: 'Content',
    description: 'Writes specs, docs, READMEs, and technical guides.',
  },
  {
    value: 'requirements',
    label: 'Requirements',
    category: 'Content',
    description: 'Gathers, refines, and validates requirements and acceptance criteria.',
  },
  {
    value: 'research',
    label: 'Research',
    category: 'Analysis',
    description: 'Investigates options, evaluates trade-offs, explores solutions.',
  },
  {
    value: 'workspace-management',
    label: 'Workspace management',
    category: 'Coordination',
    description: 'Plans, coordinates, tracks progress, and manages stakeholders.',
  },
  {
    value: 'data-analysis',
    label: 'Data analysis',
    category: 'Analysis',
    description: 'Processes, analyzes, and visualizes data.',
  },
];

export const NATIVE_SEARCH_TOOL = 'native_search';

export const KNOWN_TOOLS = ['file_read', 'file_write', 'file_edit', 'file_list', 'grep', 'glob', 'tool_search', 'shell_exec', 'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push', 'artifact_upload', 'artifact_list', 'artifact_read', 'memory_read', 'memory_search', 'memory_write', 'web_fetch', 'escalate'];

export function createRoleForm(role?: RoleDefinition | null): RoleFormState {
  return {
    name: role?.name ?? '',
    description: role?.description ?? '',
    systemPrompt: role?.system_prompt ?? '',
    allowedTools: role?.allowed_tools ?? [...KNOWN_TOOLS],
    capabilities: role?.capabilities ?? [],
    isActive: role?.is_active ?? true,
    executionContainer: {
      image: role?.execution_container_config?.image ?? '',
      cpu: role?.execution_container_config?.cpu ?? '',
      memory: role?.execution_container_config?.memory ?? '',
      pullPolicy: role?.execution_container_config?.pull_policy ?? '',
    },
  };
}

export function createDuplicateRoleForm(source: RoleDefinition): RoleFormState {
  const form = createRoleForm(source);
  form.name = '';
  return form;
}

export function buildRolePayload(form: RoleFormState) {
  const executionContainerConfig = buildExecutionContainerPayload(form.executionContainer);
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    systemPrompt: form.systemPrompt.trim() || undefined,
    allowedTools: normalizeStringList(form.allowedTools),
    capabilities: normalizeStringList(form.capabilities),
    ...(executionContainerConfig ? { executionContainerConfig } : {}),
    isActive: form.isActive,
  };
}

function buildExecutionContainerPayload(form: RoleExecutionContainerFormState) {
  const image = form.image.trim();
  const cpu = form.cpu.trim();
  const memory = form.memory.trim();
  const pullPolicy = form.pullPolicy.trim();

  if (!image && !cpu && !memory && !pullPolicy) {
    return undefined;
  }

  return {
    image: image || undefined,
    cpu: cpu || undefined,
    memory: memory || undefined,
    pullPolicy: pullPolicy || undefined,
  };
}

export function listAvailableTools(
  role?: RoleDefinition | null,
  model?: LlmModelRecord | null,
): string[] {
  const storedTools = (role?.allowed_tools ?? []).filter(
    (tool) => tool !== NATIVE_SEARCH_TOOL || supportsNativeSearch(model),
  );
  const nativeSearchTools = supportsNativeSearch(model) ? [NATIVE_SEARCH_TOOL] : [];
  return normalizeStringList([...storedTools, ...KNOWN_TOOLS, ...nativeSearchTools]).sort((left, right) =>
    left.localeCompare(right),
  );
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

export function listAvailableCapabilities(role?: RoleDefinition | null): CapabilityOption[] {
  const catalog = new Map(
    KNOWN_CAPABILITY_CATALOG.map((capability) => [capability.value, capability] as const),
  );
  for (const capability of role?.capabilities ?? []) {
    if (!catalog.has(capability)) {
      catalog.set(capability, {
        value: capability,
        label: capability,
        category: 'Custom',
        description: 'Existing custom capability preserved from the stored role definition.',
      });
    }
  }

  return [...catalog.values()].sort((left, right) => {
    const categoryOrder = left.category.localeCompare(right.category);
    return categoryOrder !== 0 ? categoryOrder : left.label.localeCompare(right.label);
  });
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
      builtIn: summary.builtIn + (role.is_built_in ? 1 : 0),
      custom: summary.custom + (role.is_built_in ? 0 : 1),
    }),
    { total: 0, active: 0, builtIn: 0, custom: 0 },
  );
}

export function describeRoleModelPolicy(role: RoleDefinition) {
  return {
    primary: role.model_preference?.trim() || 'System default',
  };
}

function normalizeStringList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function supportsNativeSearch(model?: LlmModelRecord | null): boolean {
  return Boolean(model?.native_search);
}
