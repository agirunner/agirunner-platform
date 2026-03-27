import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteMcpVerificationService } from '../../src/services/remote-mcp-verification-service.js';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const SERVER_ID = '00000000-0000-0000-0000-000000000201';

describe('RemoteMcpVerificationService', () => {
  let serverService: {
    createVerifiedServer: ReturnType<typeof vi.fn>;
    updateVerifiedServer: ReturnType<typeof vi.fn>;
    updateVerificationResult: ReturnType<typeof vi.fn>;
    getStoredServer: ReturnType<typeof vi.fn>;
    updateMetadataOnly: ReturnType<typeof vi.fn>;
  };
  let verifier: {
    verify: ReturnType<typeof vi.fn>;
  };
  let oauthAuthorizationResolver: {
    resolveVerificationAuthorizationValue: ReturnType<typeof vi.fn>;
  };
  let service: RemoteMcpVerificationService;

  beforeEach(() => {
    serverService = {
      createVerifiedServer: vi.fn(),
      updateVerifiedServer: vi.fn(),
      updateVerificationResult: vi.fn(),
      getStoredServer: vi.fn(),
      updateMetadataOnly: vi.fn(),
    };
    verifier = { verify: vi.fn() };
    oauthAuthorizationResolver = {
      resolveVerificationAuthorizationValue: vi.fn(),
    };
    service = new RemoteMcpVerificationService(
      serverService as never,
      verifier as never,
      oauthAuthorizationResolver as never,
    );
  });

  it('rejects verification when discovery returns zero tools', async () => {
    verifier.verify.mockResolvedValueOnce({
      verification_status: 'verified',
      verification_error: null,
      verified_transport: 'streamable_http',
      verification_contract_version: 'remote-mcp-v1',
      discovered_tools_snapshot: [],
    });

    await expect(
      service.createServer(TENANT_ID, {
        name: 'Empty MCP',
        description: '',
        endpointUrl: 'https://mcp.example.test/server',
        callTimeoutSeconds: 300,
        authMode: 'none',
        enabledByDefaultForNewSpecialists: false,
        grantToAllExistingSpecialists: false,
        parameters: [],
      }),
    ).rejects.toThrow('zero tools');
    expect(serverService.createVerifiedServer).not.toHaveBeenCalled();
  });

  it('persists verified transport snapshots on create', async () => {
    verifier.verify.mockResolvedValueOnce({
      verification_status: 'verified',
      verification_error: null,
      verified_transport: 'http_sse_compat',
      verification_contract_version: 'remote-mcp-v1',
      discovered_tools_snapshot: [
        { original_name: 'search', runtime_tool_name_preview: 'mcp_docs_search' },
      ],
    });
    serverService.createVerifiedServer.mockResolvedValueOnce({ id: SERVER_ID });

    await service.createServer(TENANT_ID, {
      name: 'Docs MCP',
      description: '',
      endpointUrl: 'https://mcp.example.test/server',
      callTimeoutSeconds: 300,
      authMode: 'none',
      enabledByDefaultForNewSpecialists: false,
      grantToAllExistingSpecialists: false,
      parameters: [],
    });

    expect(serverService.createVerifiedServer).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        callTimeoutSeconds: 300,
        verifiedTransport: 'http_sse_compat',
        verificationContractVersion: 'remote-mcp-v1',
      }),
    );
  });

  it('adds the stored oauth authorization header when reverifying oauth-backed servers', async () => {
    serverService.getStoredServer.mockResolvedValueOnce({
      id: SERVER_ID,
      endpoint_url: 'https://mcp.example.test/server',
      call_timeout_seconds: 300,
      auth_mode: 'oauth',
      oauth_config: {
        authorizationEndpoint: 'https://auth.example.test/authorize',
        tokenEndpoint: 'https://auth.example.test/token',
        registrationEndpoint: null,
        issuer: null,
        clientId: 'client-id',
        clientSecret: null,
        tokenEndpointAuthMethod: 'none',
        clientIdMetadataDocumentUrl: null,
        redirectUri: 'http://localhost:1455/auth/callback',
        scopes: ['mcp'],
        resource: 'https://mcp.example.test/server',
      },
      oauth_credentials: {
        accessToken: 'enc:v1:token',
        refreshToken: null,
        expiresAt: null,
        tokenType: 'Bearer',
        scope: 'mcp',
        authorizedAt: new Date().toISOString(),
        authorizedByUserId: 'user-1',
        needsReauth: false,
      },
      parameters: [],
    });
    oauthAuthorizationResolver.resolveVerificationAuthorizationValue.mockResolvedValueOnce(
      'Bearer oauth-token',
    );
    verifier.verify.mockResolvedValueOnce({
      verification_status: 'verified',
      verification_error: null,
      verified_transport: 'streamable_http',
      verification_contract_version: 'remote-mcp-v1',
      discovered_tools_snapshot: [{ original_name: 'search' }],
    });
    serverService.updateVerificationResult.mockResolvedValueOnce({ id: SERVER_ID });

    await service.reverifyServer(TENANT_ID, SERVER_ID);

    expect(oauthAuthorizationResolver.resolveVerificationAuthorizationValue).toHaveBeenCalledWith(
      expect.objectContaining({ id: SERVER_ID }),
    );
    expect(verifier.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        callTimeoutSeconds: 300,
        authMode: 'oauth',
        parameters: [
          {
            placement: 'header',
            key: 'Authorization',
            valueKind: 'secret',
            value: 'Bearer oauth-token',
          },
        ],
      }),
    );
  });
});
