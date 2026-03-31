import { beforeEach, describe, expect, it } from 'vitest';

import { configureProviderSecretEncryptionKey } from '../../../src/lib/oauth-crypto.js';
import { decryptRemoteMcpSecret } from '../../../src/services/remote-mcp/core/remote-mcp-secret-crypto.js';
import {
  buildStoredOauthCredentials,
  mergeOauthDefinitionWithClientProfile,
  resolveEffectiveGrantType,
  selectAuthorizeQueryParameters,
} from '../../../src/services/remote-mcp/remote-mcp-oauth-helpers.js';

describe('remote-mcp-oauth-helpers', () => {
  beforeEach(() => {
    configureProviderSecretEncryptionKey('0123456789abcdef0123456789abcdef');
  });

  it('resolves enterprise-managed grant types from the embedded enterprise profile', () => {
    expect(resolveEffectiveGrantType({
      grantType: 'enterprise_managed_authorization',
      enterpriseProfile: {
        grant_type: 'client_credentials',
      },
    })).toBe('client_credentials');
  });

  it('merges oauth definitions with client profile defaults without overriding explicit values', () => {
    expect(mergeOauthDefinitionWithClientProfile({
      callbackMode: 'loopback',
      clientId: 'manual-client-id',
      scopes: ['custom-scope'],
    }, {
      id: 'profile-1',
      tenant_id: 'tenant-1',
      name: 'Profile',
      slug: 'profile',
      description: '',
      issuer: null,
      client_id: 'profile-client-id',
      client_secret: 'profile-client-secret',
      token_endpoint_auth_method: 'client_secret_post',
      callback_mode: 'hosted_https',
      authorization_endpoint: 'https://auth.example.test/oauth/authorize',
      token_endpoint: 'https://auth.example.test/oauth/token',
      registration_endpoint: null,
      device_authorization_endpoint: null,
      default_scopes: ['openid'],
      default_resource_indicators: ['https://resource.example.test'],
      default_audiences: ['https://aud.example.test'],
      has_stored_client_secret: true,
      linked_server_count: 0,
      created_at: new Date('2026-03-30T00:00:00.000Z'),
      updated_at: new Date('2026-03-30T00:00:00.000Z'),
    })).toMatchObject({
      callbackMode: 'hosted_https',
      clientId: 'manual-client-id',
      clientSecret: 'profile-client-secret',
      tokenEndpointAuthMethod: 'client_secret_post',
      scopes: ['custom-scope'],
      resourceIndicators: ['https://resource.example.test'],
      audiences: ['https://aud.example.test'],
    });
  });

  it('builds encrypted stored oauth credentials from a token response', () => {
    const credentials = buildStoredOauthCredentials({
      access_token: ' access-token-1 ',
      refresh_token: ' refresh-token-1 ',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid profile',
    }, 'user-1');

    expect(decryptRemoteMcpSecret(credentials.accessToken)).toBe('access-token-1');
    expect(decryptRemoteMcpSecret(credentials.refreshToken ?? '')).toBe('refresh-token-1');
    expect(credentials.authorizedByUserId).toBe('user-1');
    expect(credentials.needsReauth).toBe(false);
  });

  it('keeps only non-empty authorize request query parameters', () => {
    expect(selectAuthorizeQueryParameters([
      {
        placement: 'query',
        key: 'tenant',
        valueKind: 'static',
        value: 'docs',
      },
      {
        placement: 'authorize_request_query',
        key: 'prompt',
        valueKind: 'static',
        value: 'consent',
      },
      {
        placement: 'authorize_request_query',
        key: 'empty',
        valueKind: 'static',
        value: '   ',
      },
    ])).toEqual([
      { key: 'prompt', value: 'consent' },
    ]);
  });
});
