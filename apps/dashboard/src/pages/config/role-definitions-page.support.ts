export interface RoleDefinition {
  id: string;
  name: string;
  description?: string | null;
  system_prompt?: string | null;
  allowed_tools?: string[];
  capabilities?: string[];
  model_preference?: string | null;
  fallback_model?: string | null;
  verification_strategy?: string | null;
  escalation_target?: string | null;
  max_escalation_depth?: number | null;
  is_built_in?: boolean;
  is_active?: boolean;
}

export interface RoleFormState {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  capabilities: string[];
  modelPreference: string;
  fallbackModel: string;
  verificationStrategy: string;
  escalationTarget: string | null;
  maxEscalationDepth: number;
  isActive: boolean;
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

export interface LlmModelRecord {
  id: string;
  model_id: string;
  provider_id?: string | null;
  provider_name?: string | null;
  reasoning_config?: ReasoningConfigSchema | null;
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
    value: 'llm-api',
    label: 'LLM API',
    category: 'Core',
    description: 'Role can operate through language-model APIs.',
  },
  {
    value: 'code-execution',
    label: 'Code execution',
    category: 'Execution',
    description: 'Role is expected to run code, tests, or scripts.',
  },
  {
    value: 'git-operations',
    label: 'Git operations',
    category: 'Execution',
    description: 'Role can safely perform git review and checkpoint work.',
  },
  {
    value: 'web-research',
    label: 'Web research',
    category: 'Research',
    description: 'Role may search and fetch external references.',
  },
  {
    value: 'docker-exec',
    label: 'Docker execution',
    category: 'Runtime',
    description: 'Role requires docker-backed execution beyond pure LLM work.',
  },
  {
    value: 'bare-metal-exec',
    label: 'Bare metal execution',
    category: 'Runtime',
    description: 'Role requires host execution outside the sandboxed runtime.',
  },
  {
    value: 'host-filesystem-write',
    label: 'Host filesystem write',
    category: 'Runtime',
    description: 'Role may need host-level filesystem mutation.',
  },
  {
    value: 'arbitrary-network',
    label: 'Arbitrary network',
    category: 'Runtime',
    description: 'Role needs broader network access than normal web tools.',
  },
  {
    value: 'gpu',
    label: 'GPU access',
    category: 'Runtime',
    description: 'Role requires GPU-backed execution.',
  },
  {
    value: 'browser-automation',
    label: 'Browser automation',
    category: 'Runtime',
    description: 'Role runs live browser automation flows.',
  },
  {
    value: 'lang:typescript',
    label: 'TypeScript',
    category: 'Language',
    description: 'Role specializes in TypeScript artifacts.',
  },
  {
    value: 'lang:python',
    label: 'Python',
    category: 'Language',
    description: 'Role specializes in Python artifacts.',
  },
  {
    value: 'lang:go',
    label: 'Go',
    category: 'Language',
    description: 'Role specializes in Go artifacts.',
  },
  {
    value: 'role:developer',
    label: 'Developer',
    category: 'Role identity',
    description: 'Implementation specialist.',
  },
  {
    value: 'role:reviewer',
    label: 'Reviewer',
    category: 'Role identity',
    description: 'Quality and correctness reviewer.',
  },
  {
    value: 'role:architect',
    label: 'Architect',
    category: 'Role identity',
    description: 'System design and technical direction.',
  },
  {
    value: 'role:qa',
    label: 'QA',
    category: 'Role identity',
    description: 'Validation and quality assurance.',
  },
  {
    value: 'role:product-manager',
    label: 'Product manager',
    category: 'Role identity',
    description: 'Requirements and product direction.',
  },
  {
    value: 'role:project-manager',
    label: 'Project manager',
    category: 'Role identity',
    description: 'Delivery orchestration and oversight.',
  },
];

export const KNOWN_TOOLS = ['shell_exec', 'file_read', 'file_write', 'file_edit', 'file_list', 'git_status', 'git_diff', 'git_log', 'git_commit', 'git_push', 'artifact_upload', 'artifact_list', 'artifact_read', 'memory_read', 'memory_write', 'web_fetch', 'web_search', 'escalate'];

export function createRoleForm(role?: RoleDefinition | null): RoleFormState {
  return {
    name: role?.name ?? '',
    description: role?.description ?? '',
    systemPrompt: role?.system_prompt ?? '',
    allowedTools: role?.allowed_tools ?? [],
    capabilities: role?.capabilities ?? [],
    modelPreference: role?.model_preference ?? '',
    fallbackModel: role?.fallback_model ?? '',
    verificationStrategy: role?.verification_strategy ?? 'none',
    escalationTarget: role?.escalation_target ?? null,
    maxEscalationDepth: role?.max_escalation_depth ?? 5,
    isActive: role?.is_active ?? true,
  };
}

export function buildRolePayload(form: RoleFormState) {
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    systemPrompt: form.systemPrompt.trim() || undefined,
    allowedTools: normalizeStringList(form.allowedTools),
    capabilities: normalizeStringList(form.capabilities),
    modelPreference: form.modelPreference || undefined,
    fallbackModel: form.fallbackModel || undefined,
    verificationStrategy: form.verificationStrategy,
    escalationTarget: form.escalationTarget,
    maxEscalationDepth: form.escalationTarget ? form.maxEscalationDepth : undefined,
    isActive: form.isActive,
  };
}

export function listAvailableTools(role?: RoleDefinition | null): string[] {
  return normalizeStringList([...(role?.allowed_tools ?? []), ...KNOWN_TOOLS]).sort((left, right) =>
    left.localeCompare(right),
  );
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

  for (const existing of [role?.model_preference, role?.fallback_model]) {
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
    fallback: role.fallback_model?.trim() || 'No fallback',
  };
}

function normalizeStringList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
