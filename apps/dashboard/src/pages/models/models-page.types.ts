import type { ProviderType } from './models-page.support.js';

export interface ReasoningConfigSchema {
  type: 'reasoning_effort' | 'effort' | 'thinking_level' | 'thinking_budget';
  options?: string[];
  min?: number;
  max?: number;
  default: string | number;
}

export interface OAuthStatus {
  connected: boolean;
  email: string | null;
  authorizedAt: string | null;
  expiresAt: string | null;
  authorizedBy: string | null;
  needsReauth: boolean;
}

export interface OAuthProfile {
  profileId: string;
  displayName: string;
  description: string;
  providerType: string;
  costModel: string;
}

export interface LlmProvider {
  id: string;
  name: string;
  base_url?: string;
  auth_mode?: string | null;
  metadata?: { providerType?: ProviderType };
  model_count?: number;
  credentials_configured?: boolean;
}

export interface LlmModel {
  id: string;
  model_id: string;
  provider_id?: string | null;
  provider_name?: string | null;
  context_window?: number;
  max_output_tokens?: number;
  endpoint_type?: string;
  reasoning_config?: ReasoningConfigSchema | null;
  is_enabled?: boolean;
}

export interface SystemDefault {
  modelId: string | null;
  reasoningConfig: Record<string, unknown> | null;
}

export interface RoleAssignment {
  role_name: string;
  primary_model_id?: string | null;
  reasoning_config?: Record<string, unknown> | null;
}

export interface RoleDefinitionSummary {
  id: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
}

export interface AssignmentRoleRow {
  name: string;
  description: string | null;
  isActive: boolean;
  source: 'catalog' | 'assignment' | 'system';
}

export interface ProviderDeleteTarget {
  provider: LlmProvider;
  modelCount: number;
}
