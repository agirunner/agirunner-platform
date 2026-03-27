import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../src/errors/domain-errors.js';
import { exchangeAuthorizationCodeToken } from '../../src/services/remote-mcp-oauth-http.js';
import { parseTokenResponse } from '../../src/services/remote-mcp-oauth-http-response.js';

describe('remote MCP OAuth HTTP token handling', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses form-encoded token success bodies', async () => {
    const response = new Response(
      'access_token=test-access-token&token_type=Bearer&expires_in=3600&scope=repo',
      {
        status: 200,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
      },
    );

    await expect(parseTokenResponse(response)).resolves.toEqual({
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'repo',
    });
  });

  it('rejects form-encoded token error payloads returned with success status', async () => {
    const createResponse = () =>
      new Response(
        'error=incorrect_client_credentials&error_description=The+client+secret+is+wrong',
        {
          status: 200,
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
          },
        },
      );

    await expect(parseTokenResponse(createResponse())).rejects.toThrow(ValidationError);
    await expect(parseTokenResponse(createResponse())).rejects.toThrow(
      'incorrect_client_credentials: The client secret is wrong',
    );
  });

  it('requests json token responses during authorization-code exchange', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'access-token-1',
          token_type: 'Bearer',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    await exchangeAuthorizationCodeToken(
      {
        issuer: 'https://auth.example.test',
        authorizationEndpoint: 'https://auth.example.test/oauth/authorize',
        tokenEndpoint: 'https://auth.example.test/oauth/token',
        registrationEndpoint: null,
        deviceAuthorizationEndpoint: null,
        clientId: 'client-1',
        clientSecret: null,
        tokenEndpointAuthMethod: 'none',
        clientIdMetadataDocumentUrl: null,
        redirectUri: 'http://localhost:1455/auth/callback',
        scopes: [],
        resource: 'https://mcp.example.test/server',
        resourceIndicators: [],
        audiences: [],
      },
      'test-code',
      'test-verifier',
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://auth.example.test/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          accept: 'application/json',
        }),
      }),
    );
  });
});
