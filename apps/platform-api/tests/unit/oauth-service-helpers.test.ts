import { beforeEach, describe, expect, it } from 'vitest';

import { configureProviderSecretEncryptionKey, storeOAuthToken } from '../../src/lib/oauth-crypto.js';
import {
  buildImportedCredentials,
  buildResolvedToken,
  isCredentialAccessTokenUsable,
  normalizeOAuthCredentials,
} from '../../src/services/oauth-service-credentials.js';
import { buildOAuthTokenExchangeErrorMessage } from '../../src/services/oauth-service-errors.js';
import type { OAuthConfig } from '../../src/services/oauth-service-types.js';

describe('oauth service helpers', () => {
  beforeEach(() => {
    configureProviderSecretEncryptionKey('test-webhook-encryption-key-abcdefghijklmnopqrstuvwxyz');
  });

  it('redacts secret-bearing token exchange error details', () => {
    expect(
      buildOAuthTokenExchangeErrorMessage(
        401,
        'invalid_client access_token=sk-secret-value refresh_token=abc',
      ),
    ).toBe('OAuth token exchange failed with status 401');
  });

  it('normalizes imported oauth credentials and stored credential payloads', () => {
    const imported = buildImportedCredentials(
      {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: '1710000000',
        accountId: 'acct_123',
        email: 'mark@example.com',
      },
      'user-1',
    );

    expect(
      normalizeOAuthCredentials({
        accessToken: imported.access_token,
        refreshToken: imported.refresh_token,
        expiresAt: String(imported.expires_at),
        accountId: imported.account_id,
        email: imported.email,
        authorizedAt: imported.authorized_at,
        authorizedByUserId: imported.authorized_by_user_id,
        needsReauth: imported.needs_reauth,
      }),
    ).toEqual(imported);
  });

  it('treats permanent oauth access tokens as usable even when expired', () => {
    const config: OAuthConfig = {
      profile_id: 'openai-codex',
      client_id: 'client-id',
      authorize_url: 'https://auth.example.test/oauth/authorize',
      token_url: 'https://auth.example.test/oauth/token',
      scopes: ['openid'],
      base_url: 'https://api.openai.test/v1',
      endpoint_type: 'responses',
      token_lifetime: 'permanent',
      cost_model: 'usage',
      extra_authorize_params: {},
    };

    expect(
      isCredentialAccessTokenUsable(
        {
          access_token: storeOAuthToken('access-token'),
          refresh_token: null,
          expires_at: Date.now() - 60_000,
          account_id: 'acct_123',
          email: 'mark@example.com',
          authorized_at: '2026-03-11T00:00:00.000Z',
          authorized_by_user_id: 'user-1',
          needs_reauth: false,
        },
        config,
      ),
    ).toBe(true);
  });

  it('adds OpenAI Codex account headers when building resolved tokens', () => {
    const resolved = buildResolvedToken(
      'enc:v1:stored:token:tag',
      {
        profile_id: 'openai-codex',
        client_id: 'client-id',
        authorize_url: 'https://auth.example.test/oauth/authorize',
        token_url: 'https://auth.example.test/oauth/token',
        scopes: ['openid'],
        base_url: 'https://api.openai.test/v1',
        endpoint_type: 'responses',
        token_lifetime: 'permanent',
        cost_model: 'usage',
        extra_authorize_params: {},
      },
      'acct_123',
    );

    expect(resolved).toEqual({
      accessTokenSecret: 'enc:v1:stored:token:tag',
      baseUrl: 'https://api.openai.test/v1',
      endpointType: 'responses',
      extraHeadersSecret: expect.any(String),
    });
  });
});
