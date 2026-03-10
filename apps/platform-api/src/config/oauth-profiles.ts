import type { ReasoningConfig } from './model-catalog.js';

export type { ReasoningConfig };

export interface OAuthStaticModel {
  modelId: string;
  contextWindow: number;
  maxOutputTokens: number;
  endpointType: string;
  supportsToolUse: boolean;
  supportsVision: boolean;
  inputCostPerMillionUsd: number | null;
  outputCostPerMillionUsd: number | null;
  reasoningConfig: ReasoningConfig | null;
}

export interface OAuthProviderProfile {
  profileId: string;
  displayName: string;
  description: string;
  providerType: string;
  authorizeUrl: string;
  tokenUrl: string | null;
  clientId: string | null;
  scopes: string[];
  baseUrl: string;
  endpointType: string;
  tokenLifetime: 'short' | 'permanent';
  costModel: 'pay_per_token' | 'subscription';
  extraAuthorizeParams: Record<string, string>;
  staticModels: OAuthStaticModel[];
}

/**
 * OAuth static models use subscription-tier specs that may differ from the
 * API-tier values in MODEL_CATALOG (e.g. lower context windows). Cost fields
 * are null because subscription models are not billed per-token.
 */
export const OPENAI_CODEX_PROFILE: OAuthProviderProfile = {
  profileId: 'openai-codex',
  displayName: 'OpenAI (Subscription)',
  description: 'Use your ChatGPT Plus/Pro/Team subscription to access GPT-5, Codex, and o-series models.',
  providerType: 'openai',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  baseUrl: 'https://chatgpt.com/backend-api',
  endpointType: 'responses',
  tokenLifetime: 'short',
  costModel: 'subscription',
  extraAuthorizeParams: {
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'agirunner',
  },
  staticModels: [
    { modelId: 'gpt-5.4',             contextWindow: 1_050_000, maxOutputTokens: 128_000, endpointType: 'responses', supportsToolUse: true,  supportsVision: true,  inputCostPerMillionUsd: null, outputCostPerMillionUsd: null, reasoningConfig: { type: 'reasoning_effort', options: ['none', 'low', 'medium', 'high', 'xhigh'], default: 'high' } },
    { modelId: 'gpt-5.3-codex',       contextWindow: 272_000,   maxOutputTokens: 128_000, endpointType: 'responses', supportsToolUse: true,  supportsVision: false, inputCostPerMillionUsd: null, outputCostPerMillionUsd: null, reasoningConfig: { type: 'reasoning_effort', options: ['low', 'medium', 'high', 'xhigh'], default: 'high' } },
    { modelId: 'gpt-5.3-codex-spark', contextWindow: 272_000,   maxOutputTokens: 128_000, endpointType: 'responses', supportsToolUse: true,  supportsVision: false, inputCostPerMillionUsd: null, outputCostPerMillionUsd: null, reasoningConfig: null },
    { modelId: 'gpt-5-codex-mini',    contextWindow: 262_144,   maxOutputTokens: 128_000, endpointType: 'responses', supportsToolUse: true,  supportsVision: false, inputCostPerMillionUsd: null, outputCostPerMillionUsd: null, reasoningConfig: { type: 'reasoning_effort', options: ['low', 'medium', 'high', 'xhigh'], default: 'medium' } },
  ],
};

const PROFILES: Record<string, OAuthProviderProfile> = {
  'openai-codex': OPENAI_CODEX_PROFILE,
};

export function getOAuthProfile(profileId: string): OAuthProviderProfile {
  const profile = PROFILES[profileId];
  if (!profile) {
    throw new Error(`Unknown OAuth provider profile: ${profileId}`);
  }
  return profile;
}

export function listOAuthProfiles(): OAuthProviderProfile[] {
  return Object.values(PROFILES);
}
