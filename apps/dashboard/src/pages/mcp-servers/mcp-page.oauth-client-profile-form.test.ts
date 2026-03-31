import { describe, expect, it } from 'vitest';

import {
  buildRemoteMcpOAuthClientProfileCreatePayload,
  buildRemoteMcpOAuthClientProfileUpdatePayload,
  createRemoteMcpOAuthClientProfileForm,
} from './mcp-page.oauth-client-profile-form.js';

describe('remote mcp oauth client profile form', () => {
  it('starts with an empty reusable client profile form', () => {
    const form = createRemoteMcpOAuthClientProfileForm();

    expect(form.name).toBe('');
    expect(form.callbackMode).toBe('loopback');
    expect(form.tokenEndpointAuthMethod).toBe('none');
    expect(form.hasStoredClientSecret).toBe(false);
  });

  it('hydrates stored client secrets without exposing plaintext', () => {
    const form = createRemoteMcpOAuthClientProfileForm({
      id: 'profile-1',
      name: 'Shared OAuth client',
      slug: 'shared-oauth-client',
      description: 'Reusable host client',
      issuer: 'https://issuer.example.test',
      authorization_endpoint: 'https://issuer.example.test/authorize',
      token_endpoint: 'https://issuer.example.test/token',
      registration_endpoint: null,
      device_authorization_endpoint: null,
      callback_mode: 'loopback',
      token_endpoint_auth_method: 'client_secret_post',
      client_id: 'client-123',
      client_secret: 'redacted://remote-mcp-secret',
      has_stored_client_secret: true,
      default_scopes: ['read:docs'],
      default_resource_indicators: ['https://api.example.test'],
      default_audiences: ['docs'],
      linked_server_count: 2,
      created_at: '2026-03-27T00:00:00.000Z',
      updated_at: '2026-03-27T00:00:00.000Z',
    });

    expect(form.clientSecret).toBe('');
    expect(form.hasStoredClientSecret).toBe(true);
    expect(form.defaultScopesText).toBe('read:docs');
  });

  it('builds trimmed create payloads for reusable oauth client profiles', () => {
    expect(
      buildRemoteMcpOAuthClientProfileCreatePayload({
        name: ' Shared client ',
        description: ' Host-managed credentials ',
        issuer: ' https://issuer.example.test ',
        authorizationEndpoint: ' https://issuer.example.test/authorize ',
        tokenEndpoint: ' https://issuer.example.test/token ',
        registrationEndpoint: ' https://issuer.example.test/register ',
        deviceAuthorizationEndpoint: ' https://issuer.example.test/device ',
        callbackMode: 'hosted_https',
        tokenEndpointAuthMethod: 'client_secret_basic',
        clientId: ' shared-client ',
        clientSecret: ' top-secret ',
        hasStoredClientSecret: false,
        defaultScopesText: 'read:docs\nwrite:docs',
        defaultResourceIndicatorsText: 'https://api.example.test',
        defaultAudiencesText: 'docs,search',
      }),
    ).toEqual({
      name: 'Shared client',
      description: 'Host-managed credentials',
      issuer: 'https://issuer.example.test',
      authorizationEndpoint: 'https://issuer.example.test/authorize',
      tokenEndpoint: 'https://issuer.example.test/token',
      registrationEndpoint: 'https://issuer.example.test/register',
      deviceAuthorizationEndpoint: 'https://issuer.example.test/device',
      callbackMode: 'hosted_https',
      tokenEndpointAuthMethod: 'client_secret_basic',
      clientId: 'shared-client',
      clientSecret: 'top-secret',
      defaultScopes: ['read:docs', 'write:docs'],
      defaultResourceIndicators: ['https://api.example.test'],
      defaultAudiences: ['docs', 'search'],
    });
  });

  it('preserves stored client secrets when updates leave the field blank', () => {
    expect(
      buildRemoteMcpOAuthClientProfileUpdatePayload({
        name: 'Shared client',
        description: '',
        issuer: '',
        authorizationEndpoint: '',
        tokenEndpoint: 'https://issuer.example.test/token',
        registrationEndpoint: '',
        deviceAuthorizationEndpoint: '',
        callbackMode: 'loopback',
        tokenEndpointAuthMethod: 'client_secret_post',
        clientId: 'shared-client',
        clientSecret: '',
        hasStoredClientSecret: true,
        defaultScopesText: '',
        defaultResourceIndicatorsText: '',
        defaultAudiencesText: '',
      }),
    ).toEqual({
      name: 'Shared client',
      description: '',
      issuer: null,
      authorizationEndpoint: null,
      tokenEndpoint: 'https://issuer.example.test/token',
      registrationEndpoint: null,
      deviceAuthorizationEndpoint: null,
      callbackMode: 'loopback',
      tokenEndpointAuthMethod: 'client_secret_post',
      clientId: 'shared-client',
      clientSecret: undefined,
      defaultScopes: [],
      defaultResourceIndicators: [],
      defaultAudiences: [],
    });
  });
});
