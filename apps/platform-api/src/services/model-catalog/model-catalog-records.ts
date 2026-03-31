import { normalizeStoredProviderSecret } from '../../lib/oauth-crypto.js';
import { ValidationError } from '../../errors/domain-errors.js';
import {
  readNativeSearchCapability,
  type NativeSearchCapability,
} from '../llm-discovery-service.js';
import { sanitizeSecretLikeRecord } from '../secret-redaction.js';

export interface ProviderRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  name: string;
  base_url: string;
  api_key_secret_ref: string | null;
  is_enabled: boolean;
  rate_limit_rpm: number | null;
  metadata: Record<string, unknown>;
  auth_mode: string | null;
  oauth_config?: Record<string, unknown> | null;
  oauth_credentials?: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProviderRecord {
  id: string;
  tenant_id: string;
  name: string;
  base_url: string;
  auth_mode: string;
  is_enabled: boolean;
  rate_limit_rpm: number | null;
  metadata: Record<string, unknown>;
  credentials_configured: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ModelRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  provider_id: string;
  model_id: string;
  context_window: number | null;
  max_output_tokens: number | null;
  supports_tool_use: boolean;
  supports_vision: boolean;
  input_cost_per_million_usd: string | null;
  output_cost_per_million_usd: string | null;
  is_enabled: boolean;
  endpoint_type: string | null;
  reasoning_config: Record<string, unknown> | null;
  native_search?: NativeSearchCapability | null;
  created_at: Date;
  provider_name: string | null;
  auth_mode: string | null;
}

export interface AssignmentRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  role_name: string;
  primary_model_id: string | null;
  reasoning_config: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface ResolvedRoleConfig {
  provider: {
    name: string;
    providerType: string;
    baseUrl: string;
    apiKeySecretRef: string | null;
    authMode: string;
    providerId: string | null;
  };
  model: {
    modelId: string;
    contextWindow: number | null;
    maxOutputTokens: number | null;
    endpointType: string | null;
    reasoningConfig: Record<string, unknown> | null;
    inputCostPerMillionUsd?: number | null;
    outputCostPerMillionUsd?: number | null;
  };
  reasoningConfig: Record<string, unknown> | null;
  nativeSearch?: NativeSearchCapability | null;
}

export function attachNativeSearchCapability(model: ModelRow): ModelRow {
  return {
    ...model,
    native_search: readNativeSearchCapability(model.model_id),
  };
}

export function normalizeSecretValue(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return normalizeStoredProviderSecret(trimmed);
}

export function parseNullableCost(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sanitizeProvider(provider: ProviderRow): ProviderRecord {
  return {
    id: provider.id,
    tenant_id: provider.tenant_id,
    name: provider.name,
    base_url: provider.base_url,
    auth_mode: provider.auth_mode ?? 'api_key',
    is_enabled: provider.is_enabled,
    rate_limit_rpm: provider.rate_limit_rpm,
    metadata: sanitizeProviderMetadata(provider.metadata),
    credentials_configured: Boolean(provider.api_key_secret_ref || provider.oauth_credentials),
    created_at: provider.created_at,
    updated_at: provider.updated_at,
  };
}

export function readProviderTypeOrThrow(metadata: unknown, providerName: string): string {
  const providerType = asRecord(metadata).providerType;
  if (typeof providerType === 'string' && providerType.trim().length > 0) {
    return providerType.trim();
  }
  throw new ValidationError(
    `Provider "${providerName}" is missing providerType metadata. Re-save the provider on the LLM Providers page before using it for execution.`,
    {
      provider_name: providerName,
    },
  );
}

function sanitizeProviderMetadata(value: unknown): Record<string, unknown> {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: 'redacted://provider-metadata-secret',
    allowSecretReferences: false,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
