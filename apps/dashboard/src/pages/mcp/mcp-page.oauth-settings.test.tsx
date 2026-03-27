import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { McpPageOauthSettings } from './mcp-page.oauth-settings.js';
import type { RemoteMcpOauthFormState } from './mcp-page.support.js';

function createOauthState(
  overrides: Partial<RemoteMcpOauthFormState> = {},
): RemoteMcpOauthFormState {
  return {
    grantType: 'authorization_code',
    clientStrategy: 'auto',
    callbackMode: 'loopback',
    clientId: '',
    clientSecret: '',
    hasStoredClientSecret: false,
    tokenEndpointAuthMethod: 'none',
    authorizationEndpointOverride: '',
    tokenEndpointOverride: '',
    registrationEndpointOverride: '',
    deviceAuthorizationEndpointOverride: '',
    protectedResourceMetadataUrlOverride: '',
    authorizationServerMetadataUrlOverride: '',
    scopesText: '',
    resourceIndicatorsText: '',
    audiencesText: '',
    enterpriseProfileText: '',
    parMode: 'disabled',
    jarMode: 'disabled',
    privateKeyPem: '',
    hasStoredPrivateKeyPem: false,
    ...overrides,
  };
}

const oauthClientProfiles = [
  {
    id: 'profile-1',
    name: 'Shared client',
    slug: 'shared-client',
    description: 'Reusable host client',
    issuer: 'https://issuer.example.test',
    authorization_endpoint: 'https://issuer.example.test/authorize',
    token_endpoint: 'https://issuer.example.test/token',
    registration_endpoint: null,
    device_authorization_endpoint: null,
    callback_mode: 'loopback' as const,
    token_endpoint_auth_method: 'client_secret_basic' as const,
    client_id: 'shared-client',
    client_secret: 'redacted://remote-mcp-secret',
    has_stored_client_secret: true,
    default_scopes: ['read:docs'],
    default_resource_indicators: [],
    default_audiences: [],
    linked_server_count: 1,
    created_at: '2026-03-27T00:00:00.000Z',
    updated_at: '2026-03-27T00:00:00.000Z',
  },
];

describe('mcp page oauth settings', () => {
  it('renders a guided default oauth surface and hides advanced fields initially', () => {
    const markup = renderToStaticMarkup(
      <McpPageOauthSettings
        value={createOauthState()}
        oauthClientProfileId=""
        oauthClientProfiles={oauthClientProfiles}
        onOauthClientProfileIdChange={() => undefined}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('OAuth setup');
    expect(markup).toContain('OAuth client profile');
    expect(markup).toContain('Leave this blank unless the remote server requires a host-managed OAuth client profile.');
    expect(markup).toContain('Advanced OAuth settings');
    expect(markup).toContain('Open this section for manual client details');
    expect(markup).not.toContain('Grant type');
    expect(markup).not.toContain('Setup mode');
    expect(markup).not.toContain('Protected resource metadata URL override');
    expect(markup).not.toContain('Authorization server metadata URL override');
    expect(markup).not.toContain('PAR mode');
    expect(markup).not.toContain('JAR mode');
    expect(markup).not.toContain('Enterprise authorization profile');
    expect(markup).not.toContain('Client ID');
    expect(markup).not.toContain('Client secret');
  });

  it('explains that manual client details live under advanced settings', () => {
    const markup = renderToStaticMarkup(
      <McpPageOauthSettings
        value={createOauthState({
          clientStrategy: 'manual_client',
        })}
        oauthClientProfileId=""
        oauthClientProfiles={oauthClientProfiles}
        onOauthClientProfileIdChange={() => undefined}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('Manual client setup requires the OAuth client and endpoint values supplied by the remote authorization server operator. Those fields live under Advanced OAuth settings.');
    expect(markup).toContain('Advanced OAuth settings');
    expect(markup).not.toContain('Grant type');
    expect(markup).not.toContain('Setup mode');
    expect(markup).not.toContain('Client ID');
    expect(markup).not.toContain('Client secret');
  });

  it('keeps advanced oauth collapsed on first render even for existing manual-client values', () => {
    const markup = renderToStaticMarkup(
      <McpPageOauthSettings
        value={createOauthState({
          clientStrategy: 'manual_client',
          clientId: 'existing-client-id',
          tokenEndpointOverride: 'https://auth.example.test/oauth/token',
        })}
        oauthClientProfileId=""
        oauthClientProfiles={oauthClientProfiles}
        onOauthClientProfileIdChange={() => undefined}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('Advanced OAuth settings');
    expect(markup).not.toContain('Manual client details');
    expect(markup).not.toContain('Client ID');
    expect(markup).not.toContain('Token endpoint');
  });

  it('summarizes the selected shared oauth client profile without exposing advanced fields', () => {
    const markup = renderToStaticMarkup(
      <McpPageOauthSettings
        value={createOauthState()}
        oauthClientProfileId="profile-1"
        oauthClientProfiles={oauthClientProfiles}
        onOauthClientProfileIdChange={() => undefined}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('Shared client');
    expect(markup).toContain('Using Shared client for reusable client credentials and endpoint defaults.');
    expect(markup).not.toContain('Grant type');
    expect(markup).not.toContain('Setup mode');
  });
});
