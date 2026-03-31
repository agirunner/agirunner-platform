import type { DatabasePool } from '../db/database.js';
import { type OAuthProviderProfile } from '../catalogs/oauth-profiles.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { OAuthConfig, OAuthCredentials, ProviderRow, StateRow } from './oauth-service-types.js';

type QueryClient = {
  query: DatabasePool['query'];
};

export async function seedStaticModels(
  pool: DatabasePool,
  tenantId: string,
  providerId: string,
  profile: OAuthProviderProfile,
): Promise<void> {
  for (const model of profile.staticModels) {
    await pool.query(
      `INSERT INTO llm_models (
        tenant_id, provider_id, model_id, context_window, max_output_tokens,
        supports_tool_use, supports_vision, endpoint_type, is_enabled,
        input_cost_per_million_usd, output_cost_per_million_usd, reasoning_config
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (tenant_id, provider_id, model_id) DO NOTHING`,
      [
        tenantId,
        providerId,
        model.modelId,
        model.contextWindow,
        model.maxOutputTokens,
        model.supportsToolUse,
        model.supportsVision,
        model.endpointType,
        true,
        null,
        null,
        model.reasoningConfig ? JSON.stringify(model.reasoningConfig) : null,
      ],
    );
  }
}

export async function markNeedsReauth(
  client: QueryClient,
  providerId: string,
): Promise<void> {
  await client.query(
    `UPDATE llm_providers
     SET oauth_credentials = jsonb_set(
       COALESCE(oauth_credentials, '{}'::jsonb),
       '{needs_reauth}', 'true'
     ), updated_at = NOW()
     WHERE id = $1`,
    [providerId],
  );
}

export async function storeCredentials(
  client: QueryClient,
  providerId: string,
  credentials: OAuthCredentials,
): Promise<void> {
  await client.query(
    `UPDATE llm_providers
     SET oauth_credentials = $1, updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(credentials), providerId],
  );
}

export async function findOrCreateProvider(
  pool: DatabasePool,
  tenantId: string,
  profile: OAuthProviderProfile,
  providerName?: string,
): Promise<string> {
  const existing = await pool.query<ProviderRow>(
    `SELECT id FROM llm_providers
     WHERE tenant_id = $1 AND auth_mode = 'oauth'
       AND oauth_config->>'profile_id' = $2`,
    [tenantId, profile.profileId],
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const config: OAuthConfig = {
    profile_id: profile.profileId,
    client_id: profile.clientId,
    authorize_url: profile.authorizeUrl,
    token_url: profile.tokenUrl,
    scopes: profile.scopes,
    base_url: profile.baseUrl,
    endpoint_type: profile.endpointType,
    token_lifetime: profile.tokenLifetime,
    cost_model: profile.costModel,
    extra_authorize_params: profile.extraAuthorizeParams,
  };

  const result = await pool.query<ProviderRow>(
    `INSERT INTO llm_providers
      (tenant_id, name, base_url, auth_mode, oauth_config, metadata)
     VALUES ($1, $2, $3, 'oauth', $4, $5)
     RETURNING id`,
    [
      tenantId,
      providerName ?? profile.displayName,
      profile.baseUrl,
      JSON.stringify(config),
      JSON.stringify({ providerType: profile.providerType }),
    ],
  );
  return result.rows[0].id;
}

export async function getProviderById(
  pool: DatabasePool,
  providerId: string,
): Promise<ProviderRow> {
  const result = await pool.query<ProviderRow>(
    'SELECT * FROM llm_providers WHERE id = $1',
    [providerId],
  );
  if (!result.rows[0]) {
    throw new NotFoundError('LLM provider not found');
  }
  return result.rows[0];
}

export async function validateAndConsumeState(
  pool: DatabasePool,
  state: string,
): Promise<StateRow> {
  await pool.query('DELETE FROM oauth_states WHERE expires_at < NOW()');

  const result = await pool.query<StateRow>(
    `DELETE FROM oauth_states
     WHERE state = $1 AND expires_at > NOW()
     RETURNING *`,
    [state],
  );

  if (!result.rows[0]) {
    throw new ValidationError(
      'Invalid or expired OAuth state. The authorization flow may have timed out. Please try again.',
    );
  }

  return result.rows[0];
}

/**
 * Redirect URI matches the OpenAI Codex CLI convention exactly:
 * http://localhost:1455/auth/callback (hardcoded port, hardcoded path).
 */
export function getRedirectUri(): string {
  return 'http://localhost:1455/auth/callback';
}
