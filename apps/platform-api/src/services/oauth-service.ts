import type { DatabasePool } from '../db/database.js';
import { z } from 'zod';
import { getOAuthProfile, type OAuthProviderProfile } from '../catalogs/oauth-profiles.js';
import {
  normalizeStoredProviderSecret,
  storeOAuthToken,
  storeProviderSecret,
  readOAuthToken,
} from '../lib/oauth-crypto.js';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../lib/pkce.js';
import { extractChatGptAccountId, extractEmailFromJwt } from '../lib/jwt-decode.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const PROVIDER_ERROR_MAX_LENGTH = 160;

interface OAuthConfig {
  profile_id: string;
  client_id: string | null;
  authorize_url: string;
  token_url: string | null;
  scopes: string[];
  base_url: string;
  endpoint_type: string;
  token_lifetime: string;
  cost_model: string;
  extra_authorize_params: Record<string, string>;
}

interface OAuthCredentials {
  access_token: string;
  refresh_token: string | null;
  expires_at: number | null;
  account_id: string | null;
  email: string | null;
  authorized_at: string;
  authorized_by_user_id: string;
  needs_reauth: boolean;
}

const importOAuthSessionSchema = z.object({
  profileId: z.string().min(1),
  providerName: z.string().min(1).max(100).optional(),
  credentials: z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1).nullable().optional(),
    expiresAt: z.union([z.number().int(), z.string().datetime()]).nullable().optional(),
    accountId: z.string().min(1).nullable().optional(),
    email: z.string().email().nullable().optional(),
    authorizedAt: z.string().datetime().optional(),
    authorizedByUserId: z.string().min(1).optional(),
    needsReauth: z.boolean().optional(),
  }),
});

export type ImportOAuthSessionInput = z.infer<typeof importOAuthSessionSchema>;

export interface ResolvedOAuthToken {
  accessTokenSecret: string;
  baseUrl: string;
  endpointType: string;
  extraHeadersSecret: string | null;
}

export interface OAuthStatus {
  connected: boolean;
  email: string | null;
  authorizedAt: string | null;
  expiresAt: string | null;
  authorizedBy: string | null;
  needsReauth: boolean;
}

interface ProviderRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  auth_mode: string;
  oauth_config: OAuthConfig | null;
  oauth_credentials: OAuthCredentials | null;
}

interface StateRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  user_id: string;
  profile_id: string;
  state: string;
  code_verifier: string;
  flow_kind?: string;
}

export class OAuthService {
  constructor(private readonly pool: DatabasePool) {}

  async importAuthorizedSession(
    tenantId: string,
    userId: string,
    input: ImportOAuthSessionInput,
  ): Promise<{ providerId: string; email: string | null }> {
    const validated = importOAuthSessionSchema.parse(input);
    const profile = getOAuthProfile(validated.profileId);
    const providerId = await this.findOrCreateProvider(
      tenantId,
      profile,
      validated.providerName?.trim() || undefined,
    );
    const credentials = buildImportedCredentials(validated.credentials, userId);

    await this.pool.query(
      `UPDATE llm_providers
       SET oauth_credentials = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(credentials), providerId],
    );

    await this.seedStaticModels(tenantId, providerId, profile);

    return { providerId, email: credentials.email };
  }

  /**
   * Initiate an OAuth flow. Provider is NOT created until the callback
   * succeeds — only an ephemeral oauth_states row is written.
   */
  async initiateFlow(
    tenantId: string,
    userId: string,
    profileId: string,
  ): Promise<{ authorizeUrl: string }> {
    const profile = getOAuthProfile(profileId);
    const redirectUri = this.getRedirectUri();

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    await this.pool.query(
      `INSERT INTO oauth_states (tenant_id, user_id, profile_id, state, code_verifier, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '10 minutes')`,
      [tenantId, userId, profileId, state, codeVerifier],
    );

    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: profile.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      ...profile.extraAuthorizeParams,
    });

    if (profile.clientId) {
      params.set('client_id', profile.clientId);
    }

    const authorizeUrl = `${profile.authorizeUrl}?${params.toString()}`;
    return { authorizeUrl };
  }

  /**
   * Handle the OAuth callback. Exchanges the authorization code for tokens,
   * then creates the provider (if new) and stores credentials.
   */
  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ providerId: string; email: string | null }> {
    const stateRow = await this.validateAndConsumeState(state);
    const profile = getOAuthProfile(stateRow.profile_id);

    if (!profile.tokenUrl) {
      throw new ValidationError('OAuth profile missing token URL');
    }

    const redirectUri = this.getRedirectUri();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: stateRow.code_verifier,
      redirect_uri: redirectUri,
    });
    if (profile.clientId) {
      body.set('client_id', profile.clientId);
    }

    const tokenResp = await fetch(profile.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!tokenResp.ok) {
      const errorText = await tokenResp.text().catch(() => '');
      throw new ValidationError(buildOAuthTokenExchangeErrorMessage(tokenResp.status, errorText));
    }

    const tokenData = await tokenResp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      id_token?: string;
    };

    let accountId: string | null = null;
    let email: string | null = null;

    if (profile.profileId === 'openai-codex') {
      accountId = extractChatGptAccountId(tokenData.access_token);
      email = extractEmailFromJwt(tokenData.id_token ?? tokenData.access_token);
    }

    // Create provider only after successful token exchange
    const providerId = await this.findOrCreateProvider(stateRow.tenant_id, profile);

    const credentials: OAuthCredentials = {
      access_token: storeOAuthToken(tokenData.access_token),
      refresh_token: tokenData.refresh_token
        ? storeOAuthToken(tokenData.refresh_token)
        : null,
      expires_at: tokenData.expires_in
        ? Date.now() + tokenData.expires_in * 1000
        : null,
      account_id: accountId,
      email,
      authorized_at: new Date().toISOString(),
      authorized_by_user_id: stateRow.user_id,
      needs_reauth: false,
    };

    await this.pool.query(
      `UPDATE llm_providers
       SET oauth_credentials = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(credentials), providerId],
    );

    await this.seedStaticModels(stateRow.tenant_id, providerId, profile);

    return { providerId, email };
  }

  async peekFlowKind(state: string): Promise<string> {
    const result = await this.pool.query<{ flow_kind: string }>(
      `SELECT flow_kind
         FROM oauth_states
        WHERE state = $1
          AND expires_at > NOW()
        LIMIT 1`,
      [state],
    );
    return result.rows[0]?.flow_kind ?? 'llm_provider';
  }

  async resolveValidToken(providerId: string): Promise<ResolvedOAuthToken> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lockResult = await client.query<ProviderRow>(
        'SELECT * FROM llm_providers WHERE id = $1 FOR UPDATE',
        [providerId],
      );
      const provider = lockResult.rows[0];
      if (!provider) throw new NotFoundError('OAuth provider not found');
      if (provider.auth_mode !== 'oauth') {
        throw new ValidationError('Provider is not configured for OAuth');
      }

      const creds = provider.oauth_credentials;
      if (!creds || creds.needs_reauth) {
        await client.query('COMMIT');
        throw new ValidationError(
          'OAuth session expired. An admin must reconnect on the LLM Providers page.',
        );
      }

      const config = provider.oauth_config;
      if (!config) {
        await client.query('COMMIT');
        throw new ValidationError('Provider missing OAuth configuration');
      }

      if (config.token_lifetime === 'permanent' || !this.isTokenExpired(creds.expires_at)) {
        await client.query('COMMIT');
        return this.buildResolvedToken(creds.access_token, config, creds.account_id);
      }

      if (!creds.refresh_token) {
        await this.markNeedsReauth(client, providerId);
        await client.query('COMMIT');
        throw new ValidationError(
          'OAuth token expired and no refresh token available. Admin must reconnect.',
        );
      }

      const refreshed = await this.refreshToken(creds, config);
      await this.storeCredentials(client, providerId, refreshed);
      await client.query('COMMIT');

      return this.buildResolvedToken(
        refreshed.access_token,
        config,
        refreshed.account_id,
      );
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async disconnect(providerId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE llm_providers
       SET oauth_credentials = NULL, updated_at = NOW()
       WHERE id = $1 AND auth_mode = 'oauth'`,
      [providerId],
    );
    if (!result.rowCount) throw new NotFoundError('OAuth provider not found');
  }

  async markProviderNeedsReauth(providerId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE llm_providers
       SET oauth_credentials = jsonb_set(
             COALESCE(oauth_credentials, '{}'::jsonb),
             '{needs_reauth}', 'true'
           ),
           updated_at = NOW()
       WHERE id = $1
         AND auth_mode = 'oauth'`,
      [providerId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('OAuth provider not found');
    }
  }

  async getStatus(providerId: string): Promise<OAuthStatus> {
    const provider = await this.getProviderById(providerId);
    if (provider.auth_mode !== 'oauth') {
      throw new ValidationError('Provider is not configured for OAuth');
    }

    const creds = provider.oauth_credentials;
    if (!creds) {
      return {
        connected: false,
        email: null,
        authorizedAt: null,
        expiresAt: null,
        authorizedBy: null,
        needsReauth: false,
      };
    }

    return {
      connected: !creds.needs_reauth,
      email: creds.email,
      authorizedAt: creds.authorized_at,
      expiresAt: creds.expires_at ? new Date(creds.expires_at).toISOString() : null,
      authorizedBy: creds.authorized_by_user_id,
      needsReauth: creds.needs_reauth,
    };
  }

  // ── Token refresh ─────────────────────────────────────────────────────

  private async refreshToken(
    creds: OAuthCredentials,
    config: OAuthConfig,
  ): Promise<OAuthCredentials> {
    if (!config.token_url || !creds.refresh_token) {
      throw new ValidationError('Cannot refresh: missing token URL or refresh token');
    }

    const refreshToken = readOAuthToken(creds.refresh_token);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    if (config.client_id) {
      body.set('client_id', config.client_id);
    }

    const resp = await fetch(config.token_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      throw new ValidationError(`OAuth token refresh failed: ${resp.status}`);
    }

    const data = await resp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    let accountId = creds.account_id;
    let email = creds.email;

    if (config.profile_id === 'openai-codex') {
      accountId = extractChatGptAccountId(data.access_token);
      email = extractEmailFromJwt(data.access_token) ?? creds.email;
    }

    return {
      access_token: storeOAuthToken(data.access_token),
      refresh_token: data.refresh_token
        ? storeOAuthToken(data.refresh_token)
        : creds.refresh_token,
      expires_at: data.expires_in
        ? Date.now() + data.expires_in * 1000
        : creds.expires_at,
      account_id: accountId,
      email,
      authorized_at: creds.authorized_at,
      authorized_by_user_id: creds.authorized_by_user_id,
      needs_reauth: false,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async seedStaticModels(
    tenantId: string,
    providerId: string,
    profile: OAuthProviderProfile,
  ): Promise<void> {
    for (const model of profile.staticModels) {
      await this.pool.query(
        `INSERT INTO llm_models (
          tenant_id, provider_id, model_id, context_window, max_output_tokens,
          supports_tool_use, supports_vision, endpoint_type, is_enabled,
          input_cost_per_million_usd, output_cost_per_million_usd, reasoning_config
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (tenant_id, provider_id, model_id) DO NOTHING`,
        [
          tenantId, providerId, model.modelId, model.contextWindow,
          model.maxOutputTokens, model.supportsToolUse, model.supportsVision,
          model.endpointType, true, null, null,
          model.reasoningConfig ? JSON.stringify(model.reasoningConfig) : null,
        ],
      );
    }
  }

  private buildResolvedToken(
    accessTokenSecret: string,
    config: OAuthConfig,
    accountId: string | null,
  ): ResolvedOAuthToken {
    const extraHeaders: Record<string, string> = {};

    if (config.profile_id === 'openai-codex' && accountId) {
      extraHeaders['chatgpt-account-id'] = accountId;
      extraHeaders['OpenAI-Beta'] = 'responses=experimental';
    }

    return {
      accessTokenSecret,
      baseUrl: config.base_url,
      endpointType: config.endpoint_type,
      extraHeadersSecret:
        Object.keys(extraHeaders).length > 0
          ? storeProviderSecret(JSON.stringify(extraHeaders))
          : null,
    };
  }

  private isTokenExpired(expiresAt: number | null): boolean {
    if (expiresAt === null) return false;
    return Date.now() >= expiresAt - EXPIRY_BUFFER_MS;
  }

  private async markNeedsReauth(
    client: { query: DatabasePool['query'] },
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

  private async storeCredentials(
    client: { query: DatabasePool['query'] },
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

  private async findOrCreateProvider(
    tenantId: string,
    profile: OAuthProviderProfile,
    providerName?: string,
  ): Promise<string> {
    const existing = await this.pool.query<ProviderRow>(
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

    const result = await this.pool.query<ProviderRow>(
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

  private async getProviderById(providerId: string): Promise<ProviderRow> {
    const result = await this.pool.query<ProviderRow>(
      'SELECT * FROM llm_providers WHERE id = $1',
      [providerId],
    );
    if (!result.rows[0]) throw new NotFoundError('LLM provider not found');
    return result.rows[0];
  }

  private async validateAndConsumeState(state: string): Promise<StateRow> {
    await this.pool.query(
      'DELETE FROM oauth_states WHERE expires_at < NOW()',
    );

    const result = await this.pool.query<StateRow>(
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
  private getRedirectUri(): string {
    return 'http://localhost:1455/auth/callback';
  }
}

function buildImportedCredentials(
  input: ImportOAuthSessionInput['credentials'],
  defaultUserId: string,
): OAuthCredentials {
  return {
    access_token: normalizeStoredProviderSecret(input.accessToken.trim()),
    refresh_token: normalizeNullableSecret(input.refreshToken),
    expires_at: normalizeImportedExpiry(input.expiresAt),
    account_id: normalizeNullableString(input.accountId),
    email: normalizeNullableString(input.email),
    authorized_at: input.authorizedAt ?? new Date().toISOString(),
    authorized_by_user_id: input.authorizedByUserId?.trim() || defaultUserId,
    needs_reauth: input.needsReauth ?? false,
  };
}

function normalizeNullableSecret(value: string | null | undefined): string | null {
  if (!value || value.trim() === '') {
    return null;
  }
  return normalizeStoredProviderSecret(value.trim());
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (!value || value.trim() === '') {
    return null;
  }
  return value.trim();
}

function normalizeImportedExpiry(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new ValidationError('OAuth import expiresAt must be a unix timestamp or ISO date string');
  }
  return parsed;
}

function buildOAuthTokenExchangeErrorMessage(status: number, rawDetail: string): string {
  const sanitized = sanitizeProviderErrorDetail(rawDetail);
  if (!sanitized) {
    return `OAuth token exchange failed with status ${status}`;
  }
  return `OAuth token exchange failed with status ${status}: ${sanitized}`;
}

function sanitizeProviderErrorDetail(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return null;
  }
  if (containsSecretLikeValue(normalized)) {
    return null;
  }
  const truncated =
    normalized.length > PROVIDER_ERROR_MAX_LENGTH
      ? `${normalized.slice(0, PROVIDER_ERROR_MAX_LENGTH - 1)}...`
      : normalized;
  return truncated;
}

function containsSecretLikeValue(value: string): boolean {
  return (
    /(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|bearer|api[_-]?key|password|secret)/i.test(value)
    || /enc:v\d+:/i.test(value)
    || /secret:[A-Z0-9_:-]+/i.test(value)
    || /Bearer\s+\S+/i.test(value)
    || /\b(?:sk|rk|ghp|ghu|github_pat)_[A-Za-z0-9_-]{8,}\b/.test(value)
    || /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)
  );
}
