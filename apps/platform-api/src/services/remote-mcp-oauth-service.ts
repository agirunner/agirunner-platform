import { z } from 'zod';

import type { DatabaseQueryable } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { generateCodeChallenge, generateCodeVerifier, generateState } from '../lib/pkce.js';
import type {
  CreateVerifiedRemoteMcpServerInput,
  StoredRemoteMcpServerRecord,
  UpdateVerifiedRemoteMcpServerInput,
} from './remote-mcp-server-service.js';
import {
  remoteMcpOauthConfigSchema,
  remoteMcpOauthCredentialsSchema,
  remoteMcpOauthDefinitionSchema,
  remoteMcpParameterSchema,
  remoteMcpTransportPreferenceSchema,
  type RemoteMcpOAuthConfigRecord,
  type RemoteMcpOAuthCredentialsRecord,
  type RemoteMcpOauthDefinition,
  type RemoteMcpParameterInput,
} from './remote-mcp-model.js';
import { decryptRemoteMcpSecret, encryptRemoteMcpSecret } from './remote-mcp-secret-crypto.js';
import type { RemoteMcpVerifier } from './remote-mcp-verification-service.js';

const CALLBACK_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const CLIENT_METADATA_PATH = '/.well-known/oauth/mcp-client.json';
const HOSTED_CALLBACK_PATH = '/api/v1/oauth/callback';
const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

const draftInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  endpointUrl: z.string().min(1).max(2000),
  transportPreference: remoteMcpTransportPreferenceSchema.default('auto'),
  callTimeoutSeconds: z.number().int().min(1).max(86400).default(300),
  authMode: z.literal('oauth'),
  enabledByDefaultForNewSpecialists: z.boolean().default(false),
  grantToAllExistingSpecialists: z.boolean().default(false),
  oauthDefinition: remoteMcpOauthDefinitionSchema.nullable().optional(),
  parameters: z.array(remoteMcpParameterSchema).default([]),
}).strict();

interface StateRow {
  tenant_id: string;
  user_id: string;
  code_verifier: string;
  flow_kind: string;
  flow_payload: unknown;
}

interface DraftRow {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  description: string;
  endpoint_url: string;
  transport_preference: 'auto' | 'streamable_http' | 'http_sse_compat';
  call_timeout_seconds: number;
  auth_mode: 'oauth';
  enabled_by_default_for_new_specialists: boolean;
  grant_to_all_existing_specialists: boolean;
  oauth_definition: unknown;
  parameters: unknown;
}

interface ResourceMetadata {
  resource: string;
  authorizationServers: string[];
}

interface AuthorizationServerMetadata {
  issuer: string | null;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  deviceAuthorizationEndpoint: string | null;
  tokenEndpointAuthMethodsSupported: string[];
  codeChallengeMethodsSupported: string[];
  clientIdMetadataDocumentSupported: boolean;
}

interface PreparedOAuthFlow {
  authorizeUrl: string;
  resourceMetadata: ResourceMetadata;
  oauthConfig: RemoteMcpOAuthConfigRecord;
  codeVerifier: string;
  state: string;
}

interface RemoteMcpOAuthStatePayload {
  mode: 'draft' | 'reconnect';
  draft_id?: string;
  server_id?: string;
  resource_metadata: {
    resource: string;
  };
  oauth_config: RemoteMcpOAuthConfigRecord;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

type DraftInput = z.input<typeof draftInputSchema>;
type AuthorizationSecretInput = {
  id: string;
  oauthConfig: RemoteMcpOAuthConfigRecord | null;
  oauthCredentials: RemoteMcpOAuthCredentialsRecord | null;
};

export class RemoteMcpOAuthService {
  constructor(
    private readonly pool: DatabaseQueryable,
    private readonly serverService: {
      getStoredServer(tenantId: string, id: string): Promise<StoredRemoteMcpServerRecord>;
      createVerifiedServer(
        tenantId: string,
        input: CreateVerifiedRemoteMcpServerInput,
      ): Promise<{ id: string; name: string }>;
      updateVerifiedServer(
        tenantId: string,
        id: string,
        input: UpdateVerifiedRemoteMcpServerInput,
      ): Promise<{ id: string; name: string }>;
    },
    private readonly verifier: RemoteMcpVerifier,
    private readonly options: {
      platformPublicBaseUrl?: string;
      remoteMcpHostedCallbackBaseUrl?: string;
    },
  ) {}

  async initiateDraftAuthorization(
    tenantId: string,
    userId: string,
    input: DraftInput,
  ): Promise<{ draftId: string; authorizeUrl: string }> {
    const validated = draftInputSchema.parse(input);
    const draftInsert = await this.pool.query<{ id: string }>(
      `INSERT INTO remote_mcp_registration_drafts (
         tenant_id, user_id, name, description, endpoint_url, auth_mode,
         transport_preference, call_timeout_seconds, enabled_by_default_for_new_specialists,
         grant_to_all_existing_specialists, oauth_definition, parameters
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
       RETURNING id`,
      [
        tenantId,
        userId,
        validated.name.trim(),
        validated.description.trim(),
        validated.endpointUrl.trim(),
        'oauth',
        validated.transportPreference,
        validated.callTimeoutSeconds,
        validated.enabledByDefaultForNewSpecialists,
        validated.grantToAllExistingSpecialists,
        JSON.stringify(persistableOauthDefinition(validated.oauthDefinition ?? null)),
        JSON.stringify(validated.parameters),
      ],
    );
    const draftId = draftInsert.rows[0]?.id;
    if (!draftId) {
      throw new ValidationError('Unable to create remote MCP OAuth draft');
    }

    const flow = await this.prepareAuthorization({
      endpointUrl: validated.endpointUrl.trim(),
      oauthDefinition: validated.oauthDefinition ?? null,
      parameters: validated.parameters,
    });
    await this.insertOAuthState(tenantId, userId, flow, {
      mode: 'draft',
      draft_id: draftId,
      resource_metadata: {
        resource: flow.resourceMetadata.resource,
      },
      oauth_config: flow.oauthConfig,
    });

    return {
      draftId,
      authorizeUrl: flow.authorizeUrl,
    };
  }

  async reconnectServer(
    tenantId: string,
    userId: string,
    serverId: string,
  ): Promise<{ serverId: string; authorizeUrl: string }> {
    const current = await this.serverService.getStoredServer(tenantId, serverId);
    if (current.auth_mode !== 'oauth') {
      throw new ValidationError('Remote MCP server is not configured for OAuth');
    }
    const flow = await this.prepareAuthorization({
      endpointUrl: current.endpoint_url,
      oauthDefinition: current.oauth_definition,
      parameters: current.parameters.map((parameter) => ({
        placement: parameter.placement,
        key: parameter.key,
        valueKind: parameter.value_kind,
        value: parameter.value,
      })),
    });
    await this.insertOAuthState(tenantId, userId, flow, {
      mode: 'reconnect',
      server_id: serverId,
      resource_metadata: {
        resource: flow.resourceMetadata.resource,
      },
      oauth_config: flow.oauthConfig,
    });
    return {
      serverId,
      authorizeUrl: flow.authorizeUrl,
    };
  }

  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ serverId: string; serverName: string }> {
    const stateRow = await this.consumeState(state);
    if (stateRow.flow_kind !== 'remote_mcp') {
      throw new ValidationError('OAuth state does not belong to a remote MCP flow');
    }
    const payload = remoteMcpOAuthStatePayloadSchema.parse(stateRow.flow_payload);
    const token = await this.exchangeAuthorizationCode(code, stateRow.code_verifier, payload.oauth_config);
    const draft = payload.mode === 'draft'
      ? await this.loadDraft(stateRow.tenant_id, payload.draft_id ?? '')
      : await this.loadServerAsDraft(stateRow.tenant_id, payload.server_id ?? '');
    const verification = await this.verifyConnectedServer(draft, token.access_token);
    const oauthCredentials = buildStoredOauthCredentials(token, stateRow.user_id);

    if (payload.mode === 'draft') {
      const created = await this.serverService.createVerifiedServer(stateRow.tenant_id, {
        name: draft.name,
        description: draft.description,
        endpointUrl: draft.endpoint_url,
        transportPreference: draft.transport_preference ?? 'auto',
        callTimeoutSeconds: draft.call_timeout_seconds,
        authMode: 'oauth',
        enabledByDefaultForNewSpecialists: draft.enabled_by_default_for_new_specialists,
        grantToAllExistingSpecialists: draft.grant_to_all_existing_specialists,
        oauthDefinition: parseDraftOauthDefinition(draft.oauth_definition),
        verificationStatus: verification.verification_status,
        verificationError: verification.verification_error,
        verifiedTransport: verification.verified_transport,
        verifiedDiscoveryStrategy: verification.verified_discovery_strategy,
        verifiedOAuthStrategy: verification.verified_oauth_strategy,
        verificationContractVersion: verification.verification_contract_version,
        verifiedCapabilitySummary: verification.verified_capability_summary,
        discoveredToolsSnapshot: verification.discovered_tools_snapshot,
        discoveredResourcesSnapshot: verification.discovered_resources_snapshot,
        discoveredPromptsSnapshot: verification.discovered_prompts_snapshot,
        parameters: parseDraftParameters(draft.parameters),
        oauthConfig: persistableOauthConfig(payload.oauth_config),
        oauthCredentials,
      });
      await this.pool.query(
        'DELETE FROM remote_mcp_registration_drafts WHERE id = $1',
        [draft.id],
      );
      return {
        serverId: created.id,
        serverName: created.name,
      };
    }

    const updated = await this.serverService.updateVerifiedServer(
      stateRow.tenant_id,
      payload.server_id ?? '',
      {
        callTimeoutSeconds: draft.call_timeout_seconds,
        transportPreference: draft.transport_preference ?? 'auto',
        verificationStatus: verification.verification_status,
        verificationError: verification.verification_error,
        verifiedTransport: verification.verified_transport,
        verifiedDiscoveryStrategy: verification.verified_discovery_strategy,
        verifiedOAuthStrategy: verification.verified_oauth_strategy,
        verificationContractVersion: verification.verification_contract_version,
        verifiedCapabilitySummary: verification.verified_capability_summary,
        discoveredToolsSnapshot: verification.discovered_tools_snapshot,
        discoveredResourcesSnapshot: verification.discovered_resources_snapshot,
        discoveredPromptsSnapshot: verification.discovered_prompts_snapshot,
        oauthDefinition: parseDraftOauthDefinition(draft.oauth_definition),
        oauthConfig: persistableOauthConfig(payload.oauth_config),
        oauthCredentials,
      },
    );
    return {
      serverId: updated.id,
      serverName: updated.name,
    };
  }

  async disconnectServer(tenantId: string, serverId: string): Promise<void> {
    await this.pool.query(
      `UPDATE remote_mcp_servers
          SET oauth_config = NULL,
              oauth_credentials = NULL,
              verification_status = 'failed',
              verification_error = 'OAuth connection disconnected',
              verified_transport = NULL,
              verified_at = NULL,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, serverId],
    );
  }

  async resolveStoredAuthorizationSecret(
    server: AuthorizationSecretInput,
  ): Promise<string> {
    const authorizationValue = await this.resolveVerificationAuthorizationValue(server);
    return encryptRemoteMcpSecret(authorizationValue);
  }

  async resolveVerificationAuthorizationValue(
    server: AuthorizationSecretInput,
  ): Promise<string> {
    if (!server.oauthConfig || !server.oauthCredentials) {
      throw new ValidationError('Remote MCP OAuth server is missing a stored OAuth connection');
    }
    if (server.oauthCredentials.needsReauth) {
      throw new ValidationError('Remote MCP OAuth server requires reconnection');
    }
    const credentials = await this.ensureValidOauthCredentials(server.id, server.oauthConfig, server.oauthCredentials);
    const tokenType = credentials.tokenType?.trim() || 'Bearer';
    const accessToken = decryptRemoteMcpSecret(credentials.accessToken);
    return `${tokenType} ${accessToken}`;
  }

  private async prepareAuthorization(input: {
    endpointUrl: string;
    oauthDefinition: RemoteMcpOauthDefinition | null;
    parameters: RemoteMcpParameterInput[];
  }): Promise<PreparedOAuthFlow> {
    assertOAuthEndpointUrl(input.endpointUrl);
    const resourceMetadata = await this.discoverResourceMetadata(
      input.endpointUrl,
      input.oauthDefinition,
    );
    const authMetadata = await this.discoverEffectiveAuthorizationServerMetadata(
      input.endpointUrl,
      resourceMetadata,
      input.oauthDefinition,
    );
    const callbackMode = resolveRemoteMcpCallbackMode(
      input.oauthDefinition?.callbackMode,
      this.options.remoteMcpHostedCallbackBaseUrl,
    );
    const redirectUri = buildRemoteMcpRedirectUri(
      callbackMode,
      this.options.remoteMcpHostedCallbackBaseUrl,
    );
    const clientConfig = await this.buildClientConfig(
      authMetadata,
      resourceMetadata.resource,
      redirectUri,
      input.oauthDefinition,
    );
    const codeVerifier = generateCodeVerifier();
    const state = generateState();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const authorizeUrl = buildAuthorizeUrl(authMetadata.authorizationEndpoint, {
      clientId: clientConfig.clientId,
      redirectUri,
      scopes: clientConfig.scopes,
      state,
      codeChallenge,
      resource: resourceMetadata.resource,
      resourceIndicators: clientConfig.resourceIndicators,
      audiences: clientConfig.audiences,
      extraQueryParameters: selectAuthorizeQueryParameters(input.parameters),
    });
    return {
      authorizeUrl,
      resourceMetadata,
      oauthConfig: clientConfig,
      codeVerifier,
      state,
    };
  }

  private async insertOAuthState(
    tenantId: string,
    userId: string,
    flow: PreparedOAuthFlow,
    flowPayload: RemoteMcpOAuthStatePayload,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_states (
         tenant_id, user_id, profile_id, flow_kind, flow_payload, state, code_verifier, expires_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW() + INTERVAL '10 minutes')`,
      [
        tenantId,
        userId,
        'remote_mcp',
        'remote_mcp',
        JSON.stringify(flowPayload),
        flow.state,
        flow.codeVerifier,
      ],
    );
  }

  private async consumeState(state: string): Promise<StateRow> {
    await this.pool.query('DELETE FROM oauth_states WHERE expires_at < NOW()');
    const result = await this.pool.query<StateRow>(
      `DELETE FROM oauth_states
       WHERE state = $1
         AND expires_at > NOW()
       RETURNING tenant_id, user_id, code_verifier, flow_kind, flow_payload`,
      [state],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ValidationError('Invalid or expired OAuth state. The authorization flow may have timed out. Please try again.');
    }
    return row;
  }

  private async loadDraft(tenantId: string, draftId: string): Promise<DraftRow> {
    const result = await this.pool.query<DraftRow>(
      `SELECT *
         FROM remote_mcp_registration_drafts
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, draftId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Remote MCP OAuth draft not found');
    }
    return row;
  }

  private async loadServerAsDraft(tenantId: string, serverId: string): Promise<DraftRow> {
    const current = await this.serverService.getStoredServer(tenantId, serverId);
    return {
      id: current.id,
      tenant_id: current.tenant_id,
      user_id: '',
      name: current.name,
      description: current.description,
      endpoint_url: current.endpoint_url,
      transport_preference: current.transport_preference,
      call_timeout_seconds: current.call_timeout_seconds,
      auth_mode: 'oauth',
      enabled_by_default_for_new_specialists: current.enabled_by_default_for_new_specialists,
      grant_to_all_existing_specialists: false,
      oauth_definition: current.oauth_definition,
      parameters: current.parameters.map((parameter) => ({
        placement: parameter.placement,
        key: parameter.key,
        valueKind: parameter.value_kind,
        value: parameter.value,
      })),
    };
  }

  private async verifyConnectedServer(draft: DraftRow, accessToken: string) {
    const parameters = parseDraftParameters(draft.parameters);
    return this.verifier.verify({
      endpointUrl: draft.endpoint_url,
      transportPreference: draft.transport_preference ?? 'auto',
      callTimeoutSeconds: draft.call_timeout_seconds,
      authMode: 'oauth',
      parameters: [
        ...parameters,
        {
          placement: 'header',
          key: 'Authorization',
          valueKind: 'secret',
          value: `Bearer ${accessToken}`,
        },
      ],
    });
  }

  private async exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
    oauthConfig: RemoteMcpOAuthConfigRecord,
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: oauthConfig.redirectUri,
      client_id: oauthConfig.clientId,
    });
    if (oauthConfig.scopes.length > 0) {
      body.set('scope', oauthConfig.scopes.join(' '));
    }
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
    };
    if (oauthConfig.tokenEndpointAuthMethod === 'client_secret_post' && oauthConfig.clientSecret) {
      body.set('client_secret', oauthConfig.clientSecret);
    }
    if (oauthConfig.tokenEndpointAuthMethod === 'client_secret_basic' && oauthConfig.clientSecret) {
      headers.authorization = `Basic ${Buffer.from(`${oauthConfig.clientId}:${oauthConfig.clientSecret}`, 'utf8').toString('base64')}`;
    }
    const response = await fetch(oauthConfig.tokenEndpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ValidationError(`Remote MCP OAuth token exchange failed with status ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return response.json() as Promise<TokenResponse>;
  }

  private async refreshAccessToken(
    oauthConfig: RemoteMcpOAuthConfigRecord,
    refreshTokenSecret: string,
  ): Promise<TokenResponse> {
    const refreshToken = decryptRemoteMcpSecret(refreshTokenSecret);
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: oauthConfig.clientId,
    });
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
    };
    const clientSecret = oauthConfig.clientSecret ? decryptRemoteMcpSecret(oauthConfig.clientSecret) : null;
    if (oauthConfig.tokenEndpointAuthMethod === 'client_secret_post' && clientSecret) {
      body.set('client_secret', clientSecret);
    }
    if (oauthConfig.tokenEndpointAuthMethod === 'client_secret_basic' && clientSecret) {
      headers.authorization = `Basic ${Buffer.from(`${oauthConfig.clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
    }
    const response = await fetch(oauthConfig.tokenEndpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ValidationError(`Remote MCP OAuth token refresh failed with status ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return response.json() as Promise<TokenResponse>;
  }

  private async discoverResourceMetadata(
    endpointUrl: string,
    oauthDefinition: RemoteMcpOauthDefinition | null,
  ): Promise<ResourceMetadata> {
    const candidateUrls = oauthDefinition?.protectedResourceMetadataUrlOverride
      ? [oauthDefinition.protectedResourceMetadataUrlOverride]
      : buildProtectedResourceMetadataCandidates(endpointUrl);
    let lastStatus: number | null = null;
    for (const metadataUrl of candidateUrls) {
      const response = await fetch(metadataUrl, {
        headers: {
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        lastStatus = response.status;
        continue;
      }
      const payload = await response.json() as {
        resource?: string;
        authorization_servers?: string[];
        authorization_server?: string;
      };
      const authorizationServers = Array.isArray(payload.authorization_servers)
        ? payload.authorization_servers.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : typeof payload.authorization_server === 'string' && payload.authorization_server.trim().length > 0
          ? [payload.authorization_server.trim()]
          : [];
      return {
        resource: typeof payload.resource === 'string' && payload.resource.trim().length > 0
          ? payload.resource.trim()
          : endpointUrl,
        authorizationServers,
      };
    }
    throw new ValidationError(`Remote MCP OAuth discovery failed${lastStatus ? ` with status ${lastStatus}` : ''}`);
  }

  private async discoverEffectiveAuthorizationServerMetadata(
    endpointUrl: string,
    resourceMetadata: ResourceMetadata,
    oauthDefinition: RemoteMcpOauthDefinition | null,
  ): Promise<AuthorizationServerMetadata> {
    if (oauthDefinition?.authorizationEndpointOverride && oauthDefinition?.tokenEndpointOverride) {
      return {
        issuer: null,
        authorizationEndpoint: oauthDefinition.authorizationEndpointOverride,
        tokenEndpoint: oauthDefinition.tokenEndpointOverride,
        registrationEndpoint: oauthDefinition.registrationEndpointOverride ?? null,
        deviceAuthorizationEndpoint: oauthDefinition.deviceAuthorizationEndpointOverride ?? null,
        tokenEndpointAuthMethodsSupported: [],
        codeChallengeMethodsSupported: ['S256'],
        clientIdMetadataDocumentSupported: false,
      };
    }
    if (oauthDefinition?.authorizationServerMetadataUrlOverride) {
      return this.discoverAuthorizationServerMetadata(
        oauthDefinition.authorizationServerMetadataUrlOverride,
        true,
      );
    }
    if (resourceMetadata.authorizationServers[0]) {
      return this.discoverAuthorizationServerMetadata(resourceMetadata.authorizationServers[0]);
    }
    return this.discoverEndpointAuthorizationServerMetadata(endpointUrl);
  }

  private async discoverAuthorizationServerMetadata(
    authorizationServerUrl: string,
    directMetadataUrl = false,
  ): Promise<AuthorizationServerMetadata> {
    const candidates = directMetadataUrl
      ? [authorizationServerUrl]
      : buildAuthorizationServerMetadataCandidates(authorizationServerUrl);
    let lastStatus: number | null = null;
    for (const candidate of candidates) {
      const response = await fetch(candidate, {
        headers: {
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        lastStatus = response.status;
        continue;
      }
      return parseAuthorizationServerMetadata(response);
    }
    throw new ValidationError(`Remote MCP authorization metadata discovery failed${lastStatus ? ` with status ${lastStatus}` : ''}`);
  }

  private async discoverEndpointAuthorizationServerMetadata(endpointUrl: string): Promise<AuthorizationServerMetadata> {
    const candidates = buildEndpointAuthorizationServerMetadataCandidates(endpointUrl);
    let lastStatus: number | null = null;
    for (const candidate of candidates) {
      const response = await fetch(candidate, {
        headers: {
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        lastStatus = response.status;
        continue;
      }
      return parseAuthorizationServerMetadata(response);
    }
    throw new ValidationError(`Remote MCP authorization metadata discovery failed${lastStatus ? ` with status ${lastStatus}` : ''}`);
  }

  private async buildClientConfig(
    metadata: AuthorizationServerMetadata,
    resource: string,
    redirectUri: string,
    oauthDefinition: RemoteMcpOauthDefinition | null,
  ): Promise<RemoteMcpOAuthConfigRecord> {
    const scopes = normalizeStringList(oauthDefinition?.scopes);
    const resourceIndicators = normalizeStringList(oauthDefinition?.resourceIndicators);
    const audiences = normalizeStringList(oauthDefinition?.audiences);
    const platformPublicBaseUrl = requirePlatformPublicBaseUrl(this.options.platformPublicBaseUrl);
    if (oauthDefinition?.clientStrategy === 'manual_client' || readString(oauthDefinition?.clientId) !== null) {
      const clientId = readString(oauthDefinition?.clientId);
      if (!clientId) {
        throw new ValidationError('Remote MCP OAuth manual client strategy requires a client id');
      }
      return {
        issuer: metadata.issuer,
        authorizationEndpoint: oauthDefinition?.authorizationEndpointOverride ?? metadata.authorizationEndpoint,
        tokenEndpoint: oauthDefinition?.tokenEndpointOverride ?? metadata.tokenEndpoint,
        registrationEndpoint: oauthDefinition?.registrationEndpointOverride ?? metadata.registrationEndpoint,
        deviceAuthorizationEndpoint: oauthDefinition?.deviceAuthorizationEndpointOverride ?? metadata.deviceAuthorizationEndpoint,
        clientId,
        clientSecret: readString(oauthDefinition?.clientSecret),
        tokenEndpointAuthMethod: oauthDefinition?.tokenEndpointAuthMethod ?? 'none',
        clientIdMetadataDocumentUrl: null,
        redirectUri,
        scopes,
        resource,
        resourceIndicators,
        audiences,
      };
    }
    if (metadata.clientIdMetadataDocumentSupported) {
      return {
        issuer: metadata.issuer,
        authorizationEndpoint: metadata.authorizationEndpoint,
        tokenEndpoint: metadata.tokenEndpoint,
        registrationEndpoint: metadata.registrationEndpoint,
        deviceAuthorizationEndpoint: metadata.deviceAuthorizationEndpoint,
        clientId: buildClientMetadataUrl(platformPublicBaseUrl),
        clientSecret: null,
        tokenEndpointAuthMethod: 'none',
        clientIdMetadataDocumentUrl: buildClientMetadataUrl(platformPublicBaseUrl),
        redirectUri,
        scopes,
        resource,
        resourceIndicators,
        audiences,
      };
    }
    if (!metadata.registrationEndpoint) {
      throw new ValidationError('Remote MCP authorization server does not support client metadata documents, dynamic client registration, or a manual client');
    }
    const registration = await this.registerOAuthClient(
      metadata.registrationEndpoint,
      scopes,
      platformPublicBaseUrl,
      redirectUri,
    );
    return {
      issuer: metadata.issuer,
      authorizationEndpoint: metadata.authorizationEndpoint,
      tokenEndpoint: metadata.tokenEndpoint,
      registrationEndpoint: metadata.registrationEndpoint,
      deviceAuthorizationEndpoint: metadata.deviceAuthorizationEndpoint,
      clientId: registration.clientId,
      clientSecret: registration.clientSecret,
      tokenEndpointAuthMethod: registration.tokenEndpointAuthMethod,
      clientIdMetadataDocumentUrl: null,
      redirectUri,
      scopes,
      resource,
      resourceIndicators,
      audiences,
    };
  }

  private async registerOAuthClient(
    registrationEndpoint: string,
    scopes: string[],
    platformPublicBaseUrl: string,
    redirectUri: string,
  ): Promise<{
    clientId: string;
    clientSecret: string | null;
    tokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic';
  }> {
    const response = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        client_name: 'Agirunner MCP',
        client_uri: platformPublicBaseUrl,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: scopes.join(' '),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ValidationError(`Remote MCP OAuth client registration failed with status ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const payload = await response.json() as Record<string, unknown>;
    const clientId = readString(payload.client_id);
    if (!clientId) {
      throw new ValidationError('Remote MCP OAuth client registration did not return a client_id');
    }
    const clientSecret = readString(payload.client_secret);
    const authMethod = readString(payload.token_endpoint_auth_method);
    return {
      clientId,
      clientSecret,
      tokenEndpointAuthMethod:
        authMethod === 'client_secret_basic' || authMethod === 'client_secret_post'
          ? authMethod
          : 'none',
    };
  }

  private async ensureValidOauthCredentials(
    serverId: string,
    oauthConfig: RemoteMcpOAuthConfigRecord,
    oauthCredentials: RemoteMcpOAuthCredentialsRecord,
  ): Promise<RemoteMcpOAuthCredentialsRecord> {
    if (!isExpired(oauthCredentials.expiresAt ?? null)) {
      return oauthCredentials;
    }
    if (!oauthCredentials.refreshToken) {
      const disconnected = { ...oauthCredentials, needsReauth: true };
      await this.persistOauthCredentials(serverId, disconnected);
      throw new ValidationError('Remote MCP OAuth connection expired and must be reconnected');
    }
    const refreshed = await this.refreshAccessToken(oauthConfig, oauthCredentials.refreshToken);
    const next = {
      accessToken: encryptRemoteMcpSecret(refreshed.access_token.trim()),
      refreshToken: refreshed.refresh_token?.trim()
        ? encryptRemoteMcpSecret(refreshed.refresh_token.trim())
        : oauthCredentials.refreshToken,
      expiresAt: typeof refreshed.expires_in === 'number' && Number.isFinite(refreshed.expires_in)
        ? Date.now() + (refreshed.expires_in * 1000)
        : oauthCredentials.expiresAt,
      tokenType: refreshed.token_type?.trim() || oauthCredentials.tokenType || 'Bearer',
      scope: refreshed.scope?.trim() || oauthCredentials.scope,
      authorizedAt: new Date().toISOString(),
      authorizedByUserId: oauthCredentials.authorizedByUserId,
      needsReauth: false,
    };
    await this.persistOauthCredentials(serverId, next);
    return next;
  }

  private async persistOauthCredentials(
    serverId: string,
    oauthCredentials: RemoteMcpOAuthCredentialsRecord,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE remote_mcp_servers
          SET oauth_credentials = $2::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [serverId, JSON.stringify(oauthCredentials)],
    );
  }
}

const remoteMcpOAuthStatePayloadSchema = z.object({
  mode: z.enum(['draft', 'reconnect']),
  draft_id: z.string().min(1).optional(),
  server_id: z.string().min(1).optional(),
  resource_metadata: z.object({
    resource: z.string().min(1),
  }).strict(),
  oauth_config: remoteMcpOauthConfigSchema,
}).strict();

function assertOAuthEndpointUrl(value: string): void {
  const parsed = new URL(value);
  if (parsed.search || parsed.hash) {
    throw new ValidationError('Remote MCP endpoint URL must not include a query string or fragment');
  }
}

function buildProtectedResourceMetadataUrl(endpointUrl: string): string {
  const endpoint = new URL(endpointUrl);
  const normalizedPath = endpoint.pathname.replace(/\/+$/, '');
  return new URL(`/.well-known/oauth-protected-resource${normalizedPath}`, endpoint.origin).toString();
}

function buildProtectedResourceMetadataCandidates(endpointUrl: string): string[] {
  const endpoint = new URL(endpointUrl);
  const rawPath = endpoint.pathname;
  const normalizedPath = endpoint.pathname.replace(/\/+$/, '');
  const candidates = [
    new URL(`/.well-known/oauth-protected-resource${rawPath}`, endpoint.origin).toString(),
    new URL(`/.well-known/oauth-protected-resource${normalizedPath}`, endpoint.origin).toString(),
  ];
  if (rawPath) {
    candidates.push(new URL(`${rawPath}/.well-known/oauth-protected-resource`, endpoint.origin).toString());
  }
  if (normalizedPath) {
    candidates.push(new URL(`${normalizedPath}/.well-known/oauth-protected-resource`, endpoint.origin).toString());
  }
  return Array.from(new Set(candidates));
}

function buildAuthorizationServerMetadataCandidates(authorizationServerUrl: string): string[] {
  const authorizationServer = new URL(authorizationServerUrl);
  const normalizedPath = authorizationServer.pathname.replace(/\/+$/, '');
  const pathScopedCandidates = normalizedPath
    ? [
        new URL(`${normalizedPath}/.well-known/openid-configuration`, authorizationServer.origin).toString(),
        new URL(`${normalizedPath}/.well-known/oauth-authorization-server`, authorizationServer.origin).toString(),
      ]
    : [];
  const rootCandidates = [
    new URL('/.well-known/openid-configuration', authorizationServer.origin).toString(),
    new URL('/.well-known/oauth-authorization-server', authorizationServer.origin).toString(),
  ];
  return Array.from(new Set([...pathScopedCandidates, ...rootCandidates]));
}

function buildEndpointAuthorizationServerMetadataCandidates(endpointUrl: string): string[] {
  const endpoint = new URL(endpointUrl);
  const normalizedPath = endpoint.pathname.replace(/\/+$/, '');
  const pathScopedCandidates = normalizedPath
    ? [
        new URL(`${normalizedPath}/.well-known/oauth-authorization-server`, endpoint.origin).toString(),
      ]
    : [];
  const rootCandidates = [
    new URL('/.well-known/oauth-authorization-server', endpoint.origin).toString(),
  ];
  return Array.from(new Set([...pathScopedCandidates, ...rootCandidates]));
}

function buildClientMetadataUrl(platformPublicBaseUrl: string): string {
  return new URL(CLIENT_METADATA_PATH, platformPublicBaseUrl).toString();
}

function buildRemoteMcpRedirectUri(
  callbackMode: 'loopback' | 'hosted_https',
  hostedCallbackBaseUrl: string | undefined,
): string {
  if (callbackMode === 'hosted_https') {
    if (!hostedCallbackBaseUrl || hostedCallbackBaseUrl.trim().length === 0) {
      throw new ValidationError('Remote MCP hosted callback mode requires a hosted callback base URL');
    }
    return new URL(HOSTED_CALLBACK_PATH, hostedCallbackBaseUrl.trim()).toString();
  }
  if (!hostedCallbackBaseUrl || hostedCallbackBaseUrl.trim().length === 0) {
    return CALLBACK_REDIRECT_URI;
  }
  return CALLBACK_REDIRECT_URI;
}

function resolveRemoteMcpCallbackMode(
  requestedMode: 'loopback' | 'hosted_https' | undefined,
  hostedCallbackBaseUrl: string | undefined,
): 'loopback' | 'hosted_https' {
  if (requestedMode === 'hosted_https') {
    return 'hosted_https';
  }
  if (requestedMode === 'loopback') {
    return 'loopback';
  }
  return hostedCallbackBaseUrl && hostedCallbackBaseUrl.trim().length > 0
    ? 'hosted_https'
    : 'loopback';
}

function requirePlatformPublicBaseUrl(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new ValidationError('Platform public base URL is required for remote MCP OAuth flows');
  }
  return value.trim();
}

function buildAuthorizeUrl(
  authorizationEndpoint: string,
  input: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state: string;
    codeChallenge: string;
    resource: string;
    resourceIndicators: string[];
    audiences: string[];
    extraQueryParameters: RemoteMcpParameterInput[];
  },
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  });
  if (input.scopes.length > 0) {
    params.set('scope', input.scopes.join(' '));
  }
  const resources = input.resourceIndicators.length > 0 ? input.resourceIndicators : [input.resource];
  for (const resource of resources) {
    params.append('resource', resource);
  }
  for (const audience of input.audiences) {
    params.append('audience', audience);
  }
  for (const parameter of input.extraQueryParameters) {
    params.append(parameter.key, parameter.value);
  }
  return `${authorizationEndpoint}?${params.toString()}`;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseDraftParameters(value: unknown): RemoteMcpParameterInput[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const parsed = remoteMcpParameterSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

function parseDraftOauthDefinition(value: unknown): RemoteMcpOauthDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return remoteMcpOauthDefinitionSchema.parse(value);
}

function persistableOauthDefinition(
  value: RemoteMcpOauthDefinition | null,
): RemoteMcpOauthDefinition | null {
  if (!value) {
    return null;
  }
  return {
    ...value,
    clientSecret: value.clientSecret ? encryptRemoteMcpSecret(value.clientSecret) : null,
    privateKeyPem: value.privateKeyPem ? encryptRemoteMcpSecret(value.privateKeyPem) : null,
  };
}

function persistableOauthConfig(
  value: RemoteMcpOAuthConfigRecord,
): RemoteMcpOAuthConfigRecord {
  return {
    ...value,
    clientSecret: value.clientSecret ? encryptRemoteMcpSecret(value.clientSecret) : null,
  };
}

function buildStoredOauthCredentials(
  token: TokenResponse,
  userId: string,
): RemoteMcpOAuthCredentialsRecord {
  if (!token.access_token || token.access_token.trim() === '') {
    throw new ValidationError('Remote MCP OAuth token exchange did not return an access token');
  }
  return {
    accessToken: encryptRemoteMcpSecret(token.access_token.trim()),
    refreshToken: token.refresh_token?.trim() ? encryptRemoteMcpSecret(token.refresh_token.trim()) : null,
    expiresAt: typeof token.expires_in === 'number' && Number.isFinite(token.expires_in)
      ? Date.now() + (token.expires_in * 1000)
      : null,
    tokenType: token.token_type?.trim() || 'Bearer',
    scope: token.scope?.trim() || null,
    authorizedAt: new Date().toISOString(),
    authorizedByUserId: userId,
    needsReauth: false,
  };
}

function isExpired(expiresAt: number | null): boolean {
  return typeof expiresAt === 'number' &&
    Number.isFinite(expiresAt) &&
    expiresAt <= (Date.now() + ACCESS_TOKEN_EXPIRY_BUFFER_MS);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const normalized = readString(entry);
    return normalized ? [normalized] : [];
  });
}

function selectAuthorizeQueryParameters(
  parameters: RemoteMcpParameterInput[],
): RemoteMcpParameterInput[] {
  return parameters.filter((parameter) => parameter.placement === 'authorize_request_query');
}

async function parseAuthorizationServerMetadata(
  response: Response,
): Promise<AuthorizationServerMetadata> {
  const payload = await response.json() as Record<string, unknown>;
  const authorizationEndpoint = readString(payload.authorization_endpoint);
  const tokenEndpoint = readString(payload.token_endpoint);
  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new ValidationError('Remote MCP authorization server metadata is missing required endpoints');
  }
  return {
    issuer: readString(payload.issuer),
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: readString(payload.registration_endpoint),
    deviceAuthorizationEndpoint: readString(payload.device_authorization_endpoint),
    tokenEndpointAuthMethodsSupported: normalizeStringList(payload.token_endpoint_auth_methods_supported),
    codeChallengeMethodsSupported: normalizeStringList(payload.code_challenge_methods_supported),
    clientIdMetadataDocumentSupported: payload.client_id_metadata_document_supported === true,
  };
}
