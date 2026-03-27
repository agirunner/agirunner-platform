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
    expect(markup).toContain('Setup mode');
    expect(markup).toContain('Automatic discovery');
    expect(markup).toContain('Advanced OAuth settings');
    expect(markup).toContain('Open this section for manual client details');
    expect(markup).not.toContain('Protected resource metadata URL override');
    expect(markup).not.toContain('Authorization server metadata URL override');
    expect(markup).not.toContain('PAR mode');
    expect(markup).not.toContain('JAR mode');
    expect(markup).not.toContain('Enterprise authorization profile');
    expect(markup).not.toContain('Client ID');
    expect(markup).not.toContain('Client secret');
  });

  it('shows the required manual client fields when manual oauth setup is selected', () => {
    const markup = renderToStaticMarkup(
      <McpPageOauthSettings
        value={createOauthState({
          clientStrategy: 'manual_client',
        })}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('Manual client details');
    expect(markup).toContain('Client ID');
    expect(markup).toContain('Client secret');
    expect(markup).toContain('Authorization endpoint');
    expect(markup).toContain('Token endpoint');
    expect(markup).toContain('Token auth method');
  });
});
