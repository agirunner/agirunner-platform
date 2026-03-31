import type { DashboardExecutionEnvironmentRecord } from '../models.js';
export interface DashboardRoleDefinitionRecord {
  id: string;
  name: string;
  description: string | null;
  system_prompt?: string | null;
  allowed_tools?: string[];
  model_preference?: string | null;
  verification_strategy?: string | null;
  execution_environment_id?: string | null;
  execution_environment?: DashboardExecutionEnvironmentRecord | null;
  escalation_target?: string | null;
  max_escalation_depth?: number | null;
  is_active: boolean;
  version?: number;
  updated_at?: string | null;
}

export interface DashboardLlmSystemDefaultRecord {
  modelId: string | null;
  reasoningConfig: Record<string, unknown> | null;
}

export interface DashboardLlmAssignmentRecord {
  role_name: string;
  primary_model_id?: string | null;
  reasoning_config?: Record<string, unknown> | null;
}

export interface DashboardLlmProviderCreateInput {
  name: string;
  baseUrl: string;
  apiKeySecretRef: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardOAuthProfileRecord {
  profileId: string;
  displayName: string;
  description: string;
  providerType: string;
  costModel: string;
}

export interface DashboardOAuthStatusRecord {
  connected: boolean;
  email: string | null;
  authorizedAt: string | null;
  expiresAt: string | null;
  authorizedBy: string | null;
  needsReauth: boolean;
}
