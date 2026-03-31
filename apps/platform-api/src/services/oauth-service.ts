import type { DatabasePool } from '../db/database.js';
import { z } from 'zod';
import { getOAuthProfile } from '../catalogs/oauth-profiles.js';
import {
  storeOAuthToken,
  readOAuthToken,
  ProviderSecretDecryptionError,
} from '../lib/oauth-crypto.js';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../lib/pkce.js';
import { extractChatGptAccountId, extractEmailFromJwt } from '../lib/jwt-decode.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import {
  buildImportedCredentials,
  buildResolvedToken,
  isCredentialAccessTokenUsable,
  normalizeOAuthCredentials,
} from './oauth-service-credentials.js';
import {
  buildOAuthRefreshUnavailableError,
  buildOAuthTokenExchangeErrorMessage,
  buildProviderCredentialsUnavailableError,
  buildProviderReauthRequiredError,
  buildProviderRefreshReauthSignal,
  isProviderReauthRequiredFailure,
  isProviderRefreshReauthStatus,
} from './oauth-service-errors.js';
import {
  findOrCreateProvider,
  getProviderById,
  getRedirectUri,
  markNeedsReauth,
  seedStaticModels,
  storeCredentials,
  validateAndConsumeState,
} from './oauth-service-store.js';
import type {
  OAuthConfig,
  OAuthCredentials,
  OAuthStatus,
  ProviderRow,
  ResolvedOAuthToken,
} from './oauth-service-types.js';

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
export type { OAuthStatus, ResolvedOAuthToken } from './oauth-service-types.js';

export class OAuthService {
  constructor(private readonly pool: DatabasePool) {}

  async importAuthorizedSession(
    tenantId: string,
    userId: string,
    input: ImportOAuthSessionInput,
  ): Promise<{ providerId: string; email: string | null }> {
    const validated = importOAuthSessionSchema.parse(input);
    const profile = getOAuthProfile(validated.profileId);
    const providerId = await findOrCreateProvider(
      this.pool,
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

    await seedStaticModels(this.pool, tenantId, providerId, profile);

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
    const redirectUri = getRedirectUri();

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
    const stateRow = await validateAndConsumeState(this.pool, state);
    const profile = getOAuthProfile(stateRow.profile_id);

    if (!profile.tokenUrl) {
      throw new ValidationError('OAuth profile missing token URL');
    }

    const redirectUri = getRedirectUri();
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
    const providerId = await findOrCreateProvider(this.pool, stateRow.tenant_id, profile);

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

    await seedStaticModels(this.pool, stateRow.tenant_id, providerId, profile);

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
    let committed = false;
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

      let creds = normalizeOAuthCredentials(provider.oauth_credentials);
      const config = provider.oauth_config;
      if (!creds) {
        await client.query('COMMIT');
        committed = true;
        throw new ValidationError(
          'OAuth session expired. An admin must reconnect on the LLM Providers page.',
        );
      }

      if (!config) {
        await client.query('COMMIT');
        committed = true;
        throw new ValidationError('Provider missing OAuth configuration');
      }

      if (creds.needs_reauth && isCredentialAccessTokenUsable(creds, config)) {
        creds = { ...creds, needs_reauth: false };
        await storeCredentials(client, providerId, creds);
      }

      if (creds.needs_reauth) {
        await client.query('COMMIT');
        committed = true;
        throw new ValidationError(
          'OAuth session expired. An admin must reconnect on the LLM Providers page.',
        );
      }

      if (isCredentialAccessTokenUsable(creds, config)) {
        await client.query('COMMIT');
        committed = true;
        return buildResolvedToken(creds.access_token, config, creds.account_id);
      }

      if (!creds.refresh_token) {
        await markNeedsReauth(client, providerId);
        await client.query('COMMIT');
        committed = true;
        throw buildProviderReauthRequiredError(providerId);
      }

      let refreshed: OAuthCredentials;
      try {
        refreshed = await this.refreshToken(creds, config);
      } catch (error) {
        if (isProviderReauthRequiredFailure(error)) {
          await markNeedsReauth(client, providerId);
          await client.query('COMMIT');
          committed = true;
          throw buildProviderReauthRequiredError(providerId);
        }
        throw error;
      }
      await storeCredentials(client, providerId, refreshed);
      await client.query('COMMIT');
      committed = true;

      return buildResolvedToken(
        refreshed.access_token,
        config,
        refreshed.account_id,
      );
    } catch (err) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});
      }
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
    const provider = await getProviderById(this.pool, providerId);
    if (provider.auth_mode !== 'oauth') {
      throw new ValidationError('Provider is not configured for OAuth');
    }

    const creds = normalizeOAuthCredentials(provider.oauth_credentials);
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

    const needsReauth = creds.needs_reauth && !isCredentialAccessTokenUsable(creds, provider.oauth_config);

    return {
      connected: !needsReauth,
      email: creds.email,
      authorizedAt: creds.authorized_at,
      expiresAt: creds.expires_at ? new Date(creds.expires_at).toISOString() : null,
      authorizedBy: creds.authorized_by_user_id,
      needsReauth,
    };
  }

  // ── Token refresh ─────────────────────────────────────────────────────

  private async refreshToken(
    creds: OAuthCredentials,
    config: OAuthConfig,
  ): Promise<OAuthCredentials> {
    if (!config.token_url || !creds.refresh_token) {
      throw buildProviderRefreshReauthSignal();
    }

    let refreshToken: string;
    try {
      refreshToken = readOAuthToken(creds.refresh_token);
    } catch (error) {
      if (error instanceof ProviderSecretDecryptionError) {
        throw buildProviderCredentialsUnavailableError();
      }
      throw error;
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    if (config.client_id) {
      body.set('client_id', config.client_id);
    }

    let resp: Response;
    try {
      resp = await fetch(config.token_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch {
      throw buildOAuthRefreshUnavailableError();
    }

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => '');
      if (isProviderRefreshReauthStatus(resp.status, errorText)) {
        throw buildProviderRefreshReauthSignal();
      }
      throw buildOAuthRefreshUnavailableError(resp.status, errorText);
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

}
