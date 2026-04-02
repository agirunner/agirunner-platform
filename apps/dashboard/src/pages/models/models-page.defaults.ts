import type { AddProviderDraft, ProviderType } from './models-page.support.js';
import type {
  AssignmentRoleRow,
  LlmModel,
  ReasoningConfigSchema,
  RoleAssignment,
  RoleDefinitionSummary,
} from './models-page.types.js';

const PROVIDER_TYPE_DEFAULTS: Record<ProviderType, { name: string; baseUrl: string }> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  google: { name: 'Google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  'openai-compatible': { name: '', baseUrl: 'http://localhost:11434/v1' },
  'openai-codex': { name: 'OpenAI (Subscription)', baseUrl: 'https://chatgpt.com/backend-api' },
};

export const INITIAL_FORM: AddProviderDraft = {
  providerType: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
};

export function formatContextWindow(n?: number): string {
  if (n === undefined || n === null) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

export function getModelEnablementState(model: Pick<LlmModel, 'context_window' | 'max_output_tokens'>): {
  canEnable: boolean;
  reason: string | null;
} {
  if (hasRequiredModelLimits(model)) {
    return { canEnable: true, reason: null };
  }
  return {
    canEnable: false,
    reason: 'Needs context window and max output tokens before it can be enabled.',
  };
}

export function reasoningLabel(config?: ReasoningConfigSchema | null): string {
  if (!config) return 'none';
  if (config.options) return `${config.type} (${config.default})`;
  return `${config.type} (${config.default})`;
}

export function reasoningBadgeVariant(
  config?: ReasoningConfigSchema | null,
): 'secondary' | 'default' | 'warning' {
  if (!config) return 'secondary';
  return 'default';
}

export function getProviderTypeDefaults(providerType: ProviderType) {
  return PROVIDER_TYPE_DEFAULTS[providerType];
}

export function buildAssignmentRoleRows(
  roleDefinitions: RoleDefinitionSummary[],
  assignments: RoleAssignment[],
): AssignmentRoleRow[] {
  const catalogByName = new Map<string, RoleDefinitionSummary>();
  for (const role of roleDefinitions) {
    const normalizedName = role.name.trim();
    if (normalizedName.length === 0 || catalogByName.has(normalizedName)) {
      continue;
    }
    catalogByName.set(normalizedName, role);
  }

  const activeRoles = [...catalogByName.values()]
    .filter((role) => role.is_active !== false)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map<AssignmentRoleRow>((role) => ({
      name: role.name,
      description: role.description ?? null,
      isActive: true,
      source: 'catalog',
    }));

  const includedNames = new Set(activeRoles.map((role) => role.name));
  includedNames.add('orchestrator');

  const orchestratorRow: AssignmentRoleRow = {
    name: 'orchestrator',
    description:
      'Workflow orchestrator model used for activation planning, delegation, review, and recovery.',
    isActive: true,
    source: 'system',
  };
  const staleRows: AssignmentRoleRow[] = [];
  for (const assignment of assignments) {
    const normalizedName = assignment.role_name.trim();
    if (normalizedName.length === 0 || includedNames.has(normalizedName)) {
      continue;
    }
    const hasExplicitOverride =
      Boolean(assignment.primary_model_id) || assignment.reasoning_config != null;
    if (!hasExplicitOverride) {
      continue;
    }
    includedNames.add(normalizedName);
    const catalogRole = catalogByName.get(normalizedName);
    staleRows.push({
      name: normalizedName,
      description: catalogRole?.description ?? null,
      isActive: catalogRole?.is_active !== false && Boolean(catalogRole),
      source: catalogRole ? 'catalog' : 'assignment',
    });
  }

  staleRows.sort((left, right) => left.name.localeCompare(right.name));
  return [orchestratorRow, ...activeRoles, ...staleRows];
}

function hasRequiredModelLimits(model: Pick<LlmModel, 'context_window' | 'max_output_tokens'>): boolean {
  return typeof model.context_window === 'number' && typeof model.max_output_tokens === 'number';
}
