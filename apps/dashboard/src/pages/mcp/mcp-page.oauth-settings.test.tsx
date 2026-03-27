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

describe('mcp page oauth settings', () => {
  it('renders a guided default oauth surface and hides advanced fields initially', () => {
    const markup = renderToStaticMarkup(
      <McpPageOauthSettings value={createOauthState()} onChange={() => undefined} />,
    );

    expect(markup).toContain('OAuth setup');
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
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('Advanced OAuth settings');
    expect(markup).not.toContain('Manual client details');
    expect(markup).not.toContain('Client ID');
    expect(markup).not.toContain('Token endpoint');
  });
});
