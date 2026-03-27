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
import {
  assertOAuthEndpointUrl,
  buildAuthorizeUrl,
  buildRemoteMcpRedirectUri,
  discoverAuthorizationServerMetadata,
  discoverResourceMetadata,
  resolveRemoteMcpCallbackMode,
  type ResourceDiscoveryResult,
} from './remote-mcp-oauth-discovery.js';
import { buildOauthClientConfig } from './remote-mcp-oauth-client.js';
import {
  readMissingAuthorizationEndpointMessage,
  readMissingDeviceAuthorizationEndpointMessage,
} from './remote-mcp-oauth-errors.js';
import {
  exchangeAuthorizationCodeToken,
  exchangeClientCredentialsToken,
  pollDeviceAuthorizationToken,
  refreshRemoteMcpAccessToken,
  requestDeviceAuthorization,
} from './remote-mcp-oauth-http.js';
import {
  decryptRemoteMcpSecret,
  encryptRemoteMcpSecret,
  isRemoteMcpSecretEncrypted,
} from './remote-mcp-secret-crypto.js';
import {
  remoteMcpOAuthStatePayloadSchema,
  type DeviceAuthorizationFlow,
  type PreparedOAuthFlow,
  type RemoteMcpOAuthStartResult,
  type RemoteMcpOAuthStatePayload,
  type ResourceMetadata,
  type TokenResponse,
} from './remote-mcp-oauth-types.js';
import type { RemoteMcpVerifier } from './remote-mcp-verification-service.js';
import type { RemoteMcpOAuthClientProfileRecord } from './remote-mcp-oauth-client-profile-service.js';

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
  oauthClientProfileId: z.string().uuid().nullable().optional(),
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
  oauth_client_profile_id: string | null;
  oauth_definition: unknown;
  parameters: unknown;
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
    private readonly oauthClientProfileService?: {
      getStoredProfile(tenantId: string, id: string): Promise<RemoteMcpOAuthClientProfileRecord>;
    },
  ) {}

  async initiateDraftAuthorization(
    tenantId: string,
    userId: string,
    input: DraftInput,
  ): Promise<RemoteMcpOAuthStartResult> {
    const validated = draftInputSchema.parse(input);
    const effectiveGrantType = resolveEffectiveGrantType(validated.oauthDefinition ?? null);
    if (effectiveGrantType === 'client_credentials') {
      return this.completeClientCredentialsDraft(tenantId, userId, validated);
    }

    const draftInsert = await this.pool.query<{ id: string }>(
      `INSERT INTO remote_mcp_registration_drafts (
         tenant_id, user_id, name, description, endpoint_url, auth_mode,
         transport_preference, call_timeout_seconds, enabled_by_default_for_new_specialists,
         grant_to_all_existing_specialists, oauth_client_profile_id, oauth_definition, parameters
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)
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
        validated.oauthClientProfileId ?? null,
        JSON.stringify(persistableOauthDefinition(validated.oauthDefinition ?? null)),
        JSON.stringify(validated.parameters),
      ],
    );
    const draftId = draftInsert.rows[0]?.id;
    if (!draftId) {
      throw new ValidationError('Unable to create remote MCP OAuth draft');
    }

    if (effectiveGrantType === 'device_authorization') {
      const flow = await this.prepareDeviceAuthorization({
        tenantId,
        endpointUrl: validated.endpointUrl.trim(),
        oauthClientProfileId: validated.oauthClientProfileId ?? null,
        oauthDefinition: validated.oauthDefinition ?? null,
        parameters: validated.parameters,
      });
      await this.insertOAuthState(tenantId, userId, flow.state, '', {
        mode: 'draft',
        draft_id: draftId,
        discovery_strategy: flow.discoveryStrategy,
        oauth_strategy: flow.oauthStrategy,
        resource_metadata: {
          resource: flow.resourceMetadata.resource,
        },
        oauth_config: flow.oauthConfig,
        device_authorization: {
          device_code: flow.deviceCode,
          user_code: flow.userCode,
          verification_uri: flow.verificationURI,
          verification_uri_complete: flow.verificationURIComplete,
          expires_in_seconds: flow.expiresInSeconds,
          interval_seconds: flow.intervalSeconds,
          requested_at: Date.now(),
        },
      });
      return {
        kind: 'device',
        draftId,
        deviceFlowId: flow.state,
        userCode: flow.userCode,
        verificationUri: flow.verificationURI,
        verificationUriComplete: flow.verificationURIComplete,
        expiresInSeconds: flow.expiresInSeconds,
        intervalSeconds: flow.intervalSeconds,
      };
    }

    const flow = await this.prepareBrowserAuthorization({
      tenantId,
      endpointUrl: validated.endpointUrl.trim(),
      oauthClientProfileId: validated.oauthClientProfileId ?? null,
      oauthDefinition: validated.oauthDefinition ?? null,
      parameters: validated.parameters,
    });
    await this.insertOAuthState(tenantId, userId, flow.state, flow.codeVerifier, {
      mode: 'draft',
      draft_id: draftId,
      discovery_strategy: flow.discoveryStrategy,
      oauth_strategy: flow.oauthStrategy,
      resource_metadata: {
        resource: flow.resourceMetadata.resource,
      },
      oauth_config: flow.oauthConfig,
    });

    return {
      kind: 'browser',
      draftId,
      authorizeUrl: flow.authorizeUrl,
    };
  }

  async reconnectServer(
    tenantId: string,
    userId: string,
    serverId: string,
  ): Promise<RemoteMcpOAuthStartResult> {
    const current = await this.serverService.getStoredServer(tenantId, serverId);
    if (current.auth_mode !== 'oauth') {
      throw new ValidationError('Remote MCP server is not configured for OAuth');
    }
    const effectiveGrantType = resolveEffectiveGrantType(current.oauth_definition);
    if (effectiveGrantType === 'client_credentials') {
      return this.completeClientCredentialsReconnect(tenantId, userId, current);
    }
    if (effectiveGrantType === 'device_authorization') {
      const flow = await this.prepareDeviceAuthorization({
        tenantId,
        endpointUrl: current.endpoint_url,
        oauthClientProfileId: current.oauth_client_profile_id,
        oauthDefinition: current.oauth_definition,
        parameters: current.parameters.map((parameter) => ({
          placement: parameter.placement,
          key: parameter.key,
          valueKind: parameter.value_kind,
          value: parameter.value,
        })),
      });
      await this.insertOAuthState(tenantId, userId, flow.state, '', {
        mode: 'reconnect',
        server_id: serverId,
        discovery_strategy: flow.discoveryStrategy,
        oauth_strategy: flow.oauthStrategy,
        resource_metadata: {
          resource: flow.resourceMetadata.resource,
        },
        oauth_config: flow.oauthConfig,
        device_authorization: {
          device_code: flow.deviceCode,
          user_code: flow.userCode,
          verification_uri: flow.verificationURI,
          verification_uri_complete: flow.verificationURIComplete,
          expires_in_seconds: flow.expiresInSeconds,
          interval_seconds: flow.intervalSeconds,
          requested_at: Date.now(),
        },
      });
      return {
        kind: 'device',
        draftId: current.id,
        deviceFlowId: flow.state,
        userCode: flow.userCode,
        verificationUri: flow.verificationURI,
        verificationUriComplete: flow.verificationURIComplete,
        expiresInSeconds: flow.expiresInSeconds,
        intervalSeconds: flow.intervalSeconds,
      };
    }
    const flow = await this.prepareBrowserAuthorization({
      tenantId,
      endpointUrl: current.endpoint_url,
      oauthClientProfileId: current.oauth_client_profile_id,
      oauthDefinition: current.oauth_definition,
      parameters: current.parameters.map((parameter) => ({
        placement: parameter.placement,
        key: parameter.key,
        valueKind: parameter.value_kind,
        value: parameter.value,
      })),
    });
    await this.insertOAuthState(tenantId, userId, flow.state, flow.codeVerifier, {
      mode: 'reconnect',
      server_id: serverId,
      discovery_strategy: flow.discoveryStrategy,
      oauth_strategy: flow.oauthStrategy,
      resource_metadata: {
        resource: flow.resourceMetadata.resource,
      },
      oauth_config: flow.oauthConfig,
    });
    return {
      kind: 'browser',
      draftId: serverId,
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
    const token = await exchangeAuthorizationCodeToken(payload.oauth_config, code, stateRow.code_verifier);
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
        oauthClientProfileId: draft.oauth_client_profile_id,
        oauthDefinition: parseDraftOauthDefinition(draft.oauth_definition),
        verificationStatus: verification.verification_status,
        verificationError: verification.verification_error,
        verifiedTransport: verification.verified_transport,
        verifiedDiscoveryStrategy: payload.discovery_strategy,
        verifiedOAuthStrategy: payload.oauth_strategy,
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
        verifiedDiscoveryStrategy: payload.discovery_strategy,
        verifiedOAuthStrategy: payload.oauth_strategy,
        verificationContractVersion: verification.verification_contract_version,
        verifiedCapabilitySummary: verification.verified_capability_summary,
        discoveredToolsSnapshot: verification.discovered_tools_snapshot,
        discoveredResourcesSnapshot: verification.discovered_resources_snapshot,
        discoveredPromptsSnapshot: verification.discovered_prompts_snapshot,
        oauthClientProfileId: draft.oauth_client_profile_id,
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

  async pollDeviceAuthorization(
    deviceFlowId: string,
  ): Promise<RemoteMcpOAuthStartResult> {
    const stateRow = await this.loadState(deviceFlowId);
    if (stateRow.flow_kind !== 'remote_mcp') {
      throw new ValidationError('OAuth state does not belong to a remote MCP flow');
    }
    const payload = remoteMcpOAuthStatePayloadSchema.parse(stateRow.flow_payload);
    const deviceAuthorization = payload.device_authorization;
    if (!deviceAuthorization) {
      throw new ValidationError('Remote MCP OAuth state is not a device authorization flow');
    }
    const draft = payload.mode === 'draft'
      ? await this.loadDraft(stateRow.tenant_id, payload.draft_id ?? '')
      : await this.loadServerAsDraft(stateRow.tenant_id, payload.server_id ?? '');
    const pollResult = await pollDeviceAuthorizationToken(
      payload.oauth_config,
      deviceAuthorization.device_code,
      parseDraftParameters(draft.parameters),
    );
    if (pollResult.kind === 'pending') {
      return {
        kind: 'device',
        draftId: payload.mode === 'draft' ? (payload.draft_id ?? draft.id) : (payload.server_id ?? draft.id),
        deviceFlowId,
        userCode: deviceAuthorization.user_code,
        verificationUri: deviceAuthorization.verification_uri,
        verificationUriComplete: deviceAuthorization.verification_uri_complete,
        expiresInSeconds: deviceAuthorization.expires_in_seconds,
        intervalSeconds: pollResult.intervalSeconds,
      };
    }
    await this.deleteState(deviceFlowId);
    const verification = await this.verifyConnectedServer(draft, pollResult.token.access_token);
    const oauthCredentials = buildStoredOauthCredentials(pollResult.token, stateRow.user_id);

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
        oauthClientProfileId: draft.oauth_client_profile_id,
        oauthDefinition: parseDraftOauthDefinition(draft.oauth_definition),
        verificationStatus: verification.verification_status,
        verificationError: verification.verification_error,
        verifiedTransport: verification.verified_transport,
        verifiedDiscoveryStrategy: payload.discovery_strategy,
        verifiedOAuthStrategy: payload.oauth_strategy,
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
        kind: 'completed',
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
        verifiedDiscoveryStrategy: payload.discovery_strategy,
        verifiedOAuthStrategy: payload.oauth_strategy,
        verificationContractVersion: verification.verification_contract_version,
        verifiedCapabilitySummary: verification.verified_capability_summary,
        discoveredToolsSnapshot: verification.discovered_tools_snapshot,
        discoveredResourcesSnapshot: verification.discovered_resources_snapshot,
        discoveredPromptsSnapshot: verification.discovered_prompts_snapshot,
        oauthClientProfileId: draft.oauth_client_profile_id,
        oauthDefinition: parseDraftOauthDefinition(draft.oauth_definition),
        oauthConfig: persistableOauthConfig(payload.oauth_config),
        oauthCredentials,
      },
    );
    return {
      kind: 'completed',
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

  private async prepareBrowserAuthorization(input: {
    tenantId: string;
    endpointUrl: string;
    oauthClientProfileId: string | null;
    oauthDefinition: RemoteMcpOauthDefinition | null;
    parameters: RemoteMcpParameterInput[];
  }): Promise<PreparedOAuthFlow> {
    const oauthDefinition = await this.resolveEffectiveOauthDefinition(
      input.tenantId,
      input.oauthClientProfileId,
      input.oauthDefinition,
    );
    assertOAuthEndpointUrl(input.endpointUrl);
    const resourceDiscovery = await discoverResourceMetadata({
      endpointUrl: input.endpointUrl,
      oauthDefinition,
    });
    const authDiscovery = await discoverAuthorizationServerMetadata({
      endpointUrl: input.endpointUrl,
      resourceDiscovery,
      oauthDefinition,
    });
    const callbackMode = resolveRemoteMcpCallbackMode(
      oauthDefinition?.callbackMode,
      this.options.remoteMcpHostedCallbackBaseUrl,
    );
    const redirectUri = buildRemoteMcpRedirectUri(
      callbackMode,
      this.options.remoteMcpHostedCallbackBaseUrl,
    );
    const clientConfig = await buildOauthClientConfig({
      metadata: authDiscovery.metadata,
      resource: resourceDiscovery.metadata.resource,
      redirectUri,
      oauthDefinition,
      platformPublicBaseUrl: requirePlatformPublicBaseUrl(this.options.platformPublicBaseUrl),
    });
    if (!clientConfig.authorizationEndpoint) {
      throw new ValidationError(readMissingAuthorizationEndpointMessage(oauthDefinition));
    }
    const codeVerifier = generateCodeVerifier();
    const state = generateState();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    return {
      authorizeUrl: buildAuthorizeUrl(clientConfig.authorizationEndpoint, {
        clientId: clientConfig.clientId,
        redirectUri,
        scopes: clientConfig.scopes,
        state,
        codeChallenge,
        resource: resourceDiscovery.metadata.resource,
        resourceIndicators: clientConfig.resourceIndicators,
        audiences: clientConfig.audiences,
        extraQueryParameters: selectAuthorizeQueryParameters(input.parameters),
      }),
      resourceMetadata: resourceDiscovery.metadata,
      oauthConfig: clientConfig,
      codeVerifier,
      state,
      discoveryStrategy: `${resourceDiscovery.strategy}+${authDiscovery.strategy}`,
      oauthStrategy: resolveEffectiveGrantType(oauthDefinition),
    };
  }

  private async prepareDeviceAuthorization(input: {
    tenantId: string;
    endpointUrl: string;
    oauthClientProfileId: string | null;
    oauthDefinition: RemoteMcpOauthDefinition | null;
    parameters: RemoteMcpParameterInput[];
  }): Promise<DeviceAuthorizationFlow> {
    const oauthDefinition = await this.resolveEffectiveOauthDefinition(
      input.tenantId,
      input.oauthClientProfileId,
      input.oauthDefinition,
    );
    assertOAuthEndpointUrl(input.endpointUrl);
    const resourceDiscovery = await discoverResourceMetadata({
      endpointUrl: input.endpointUrl,
      oauthDefinition,
    });
    const authDiscovery = await discoverAuthorizationServerMetadata({
      endpointUrl: input.endpointUrl,
      resourceDiscovery,
      oauthDefinition,
    });
    const redirectUri = buildRemoteMcpRedirectUri(
      resolveRemoteMcpCallbackMode(oauthDefinition?.callbackMode, this.options.remoteMcpHostedCallbackBaseUrl),
      this.options.remoteMcpHostedCallbackBaseUrl,
    );
    const clientConfig = await buildOauthClientConfig({
      metadata: authDiscovery.metadata,
      resource: resourceDiscovery.metadata.resource,
      redirectUri,
      oauthDefinition,
      platformPublicBaseUrl: requirePlatformPublicBaseUrl(this.options.platformPublicBaseUrl),
    });
    if (!clientConfig.deviceAuthorizationEndpoint) {
      throw new ValidationError(readMissingDeviceAuthorizationEndpointMessage(oauthDefinition));
    }
    const deviceResponse = await requestDeviceAuthorization(clientConfig, input.parameters);
    return {
      resourceMetadata: resourceDiscovery.metadata,
      oauthConfig: clientConfig,
      state: generateState(),
      deviceCode: deviceResponse.device_code,
      userCode: deviceResponse.user_code,
      verificationURI: deviceResponse.verification_uri,
      verificationURIComplete: deviceResponse.verification_uri_complete ?? null,
      expiresInSeconds: deviceResponse.expires_in,
      intervalSeconds: deviceResponse.interval ?? 5,
      discoveryStrategy: `${resourceDiscovery.strategy}+${authDiscovery.strategy}`,
      oauthStrategy: resolveEffectiveGrantType(oauthDefinition),
    };
  }

  private async completeClientCredentialsDraft(
    tenantId: string,
    userId: string,
    draft: z.infer<typeof draftInputSchema>,
  ): Promise<RemoteMcpOAuthStartResult> {
    const token = await this.requestClientCredentialsToken(
      tenantId,
      draft.endpointUrl.trim(),
      draft.oauthClientProfileId ?? null,
      draft.oauthDefinition ?? null,
      draft.parameters,
    );
    const verification = await this.verifier.verify({
      endpointUrl: draft.endpointUrl.trim(),
      transportPreference: draft.transportPreference,
      callTimeoutSeconds: draft.callTimeoutSeconds,
      authMode: 'oauth',
      parameters: [
        ...draft.parameters,
        {
          placement: 'header',
          key: 'Authorization',
          valueKind: 'secret',
          value: `Bearer ${token.token.access_token}`,
        },
      ],
    });
    const created = await this.serverService.createVerifiedServer(tenantId, {
      name: draft.name.trim(),
      description: draft.description.trim(),
      endpointUrl: draft.endpointUrl.trim(),
      transportPreference: draft.transportPreference,
      callTimeoutSeconds: draft.callTimeoutSeconds,
      authMode: 'oauth',
      enabledByDefaultForNewSpecialists: draft.enabledByDefaultForNewSpecialists,
      grantToAllExistingSpecialists: draft.grantToAllExistingSpecialists,
      oauthClientProfileId: draft.oauthClientProfileId ?? null,
      oauthDefinition: draft.oauthDefinition ?? null,
      verificationStatus: verification.verification_status,
      verificationError: verification.verification_error,
      verifiedTransport: verification.verified_transport,
      verifiedDiscoveryStrategy: token.discoveryStrategy,
      verifiedOAuthStrategy: token.oauthStrategy,
      verificationContractVersion: verification.verification_contract_version,
      verifiedCapabilitySummary: verification.verified_capability_summary,
      discoveredToolsSnapshot: verification.discovered_tools_snapshot,
      discoveredResourcesSnapshot: verification.discovered_resources_snapshot,
      discoveredPromptsSnapshot: verification.discovered_prompts_snapshot,
      parameters: draft.parameters,
      oauthConfig: persistableOauthConfig(token.oauthConfig),
      oauthCredentials: buildStoredOauthCredentials(token.token, userId),
    });
    return {
      kind: 'completed',
      serverId: created.id,
      serverName: created.name,
    };
  }

  private async completeClientCredentialsReconnect(
    tenantId: string,
    userId: string,
    current: StoredRemoteMcpServerRecord,
  ): Promise<RemoteMcpOAuthStartResult> {
    const draft = await this.loadServerAsDraft(tenantId, current.id);
    const token = await this.requestClientCredentialsToken(
      tenantId,
      draft.endpoint_url,
      draft.oauth_client_profile_id,
      current.oauth_definition,
      parseDraftParameters(draft.parameters),
    );
    const verification = await this.verifyConnectedServer(draft, token.token.access_token);
    const updated = await this.serverService.updateVerifiedServer(tenantId, current.id, {
      callTimeoutSeconds: draft.call_timeout_seconds,
      transportPreference: draft.transport_preference ?? 'auto',
      verificationStatus: verification.verification_status,
      verificationError: verification.verification_error,
      verifiedTransport: verification.verified_transport,
      verifiedDiscoveryStrategy: token.discoveryStrategy,
      verifiedOAuthStrategy: token.oauthStrategy,
      verificationContractVersion: verification.verification_contract_version,
      verifiedCapabilitySummary: verification.verified_capability_summary,
      discoveredToolsSnapshot: verification.discovered_tools_snapshot,
      discoveredResourcesSnapshot: verification.discovered_resources_snapshot,
      discoveredPromptsSnapshot: verification.discovered_prompts_snapshot,
      oauthDefinition: current.oauth_definition,
      oauthConfig: persistableOauthConfig(token.oauthConfig),
      oauthCredentials: buildStoredOauthCredentials(token.token, userId),
    });
    return {
      kind: 'completed',
      serverId: updated.id,
      serverName: updated.name,
    };
  }

  private async insertOAuthState(
    tenantId: string,
    userId: string,
    state: string,
    codeVerifier: string,
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
        state,
        codeVerifier,
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

  private async loadState(state: string): Promise<StateRow> {
    await this.pool.query('DELETE FROM oauth_states WHERE expires_at < NOW()');
    const result = await this.pool.query<StateRow>(
      `SELECT tenant_id, user_id, code_verifier, flow_kind, flow_payload
         FROM oauth_states
        WHERE state = $1
          AND expires_at > NOW()`,
      [state],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ValidationError('Invalid or expired OAuth state. The authorization flow may have timed out. Please try again.');
    }
    return row;
  }

  private async deleteState(state: string): Promise<void> {
    await this.pool.query('DELETE FROM oauth_states WHERE state = $1', [state]);
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
      oauth_client_profile_id: current.oauth_client_profile_id,
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

  private async requestClientCredentialsToken(
    tenantId: string,
    endpointUrl: string,
    oauthClientProfileId: string | null,
    oauthDefinition: RemoteMcpOauthDefinition | null,
    parameters: RemoteMcpParameterInput[],
  ): Promise<{
    oauthConfig: RemoteMcpOAuthConfigRecord;
    token: TokenResponse;
    discoveryStrategy: string;
    oauthStrategy: string;
  }> {
    const effectiveOauthDefinition = await this.resolveEffectiveOauthDefinition(
      tenantId,
      oauthClientProfileId,
      oauthDefinition,
    );
    assertOAuthEndpointUrl(endpointUrl);
    const resourceDiscovery = await discoverResourceMetadata({
      endpointUrl,
      oauthDefinition: effectiveOauthDefinition,
    });
    const authDiscovery = await discoverAuthorizationServerMetadata({
      endpointUrl,
      resourceDiscovery,
      oauthDefinition: effectiveOauthDefinition,
    });
    const redirectUri = buildRemoteMcpRedirectUri(
      resolveRemoteMcpCallbackMode(effectiveOauthDefinition?.callbackMode, this.options.remoteMcpHostedCallbackBaseUrl),
      this.options.remoteMcpHostedCallbackBaseUrl,
    );
    const oauthConfig = await buildOauthClientConfig({
      metadata: authDiscovery.metadata,
      resource: resourceDiscovery.metadata.resource,
      redirectUri,
      oauthDefinition: effectiveOauthDefinition,
      platformPublicBaseUrl: requirePlatformPublicBaseUrl(this.options.platformPublicBaseUrl),
    });
    const token = await exchangeClientCredentialsToken(oauthConfig, parameters);
    return {
      oauthConfig,
      token,
      discoveryStrategy: `${resourceDiscovery.strategy}+${authDiscovery.strategy}`,
      oauthStrategy: resolveEffectiveGrantType(effectiveOauthDefinition),
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
    const refreshed = await refreshRemoteMcpAccessToken(oauthConfig, oauthCredentials.refreshToken);
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

  private async resolveEffectiveOauthDefinition(
    tenantId: string,
    oauthClientProfileId: string | null,
    oauthDefinition: RemoteMcpOauthDefinition | null,
  ): Promise<RemoteMcpOauthDefinition | null> {
    if (!oauthClientProfileId) {
      return oauthDefinition;
    }
    if (!this.oauthClientProfileService) {
      throw new ValidationError('Remote MCP OAuth client profile support is not configured');
    }
    const profile = await this.oauthClientProfileService.getStoredProfile(tenantId, oauthClientProfileId);
    return mergeOauthDefinitionWithClientProfile(oauthDefinition, profile);
  }
}

function requirePlatformPublicBaseUrl(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new ValidationError('Platform public base URL is required for remote MCP OAuth flows');
  }
  return value.trim();
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

function mergeOauthDefinitionWithClientProfile(
  oauthDefinition: RemoteMcpOauthDefinition | null,
  profile: RemoteMcpOAuthClientProfileRecord,
): RemoteMcpOauthDefinition {
  return {
    ...oauthDefinition,
    callbackMode: oauthDefinition?.callbackMode ?? profile.callback_mode,
    clientId: oauthDefinition?.clientId ?? profile.client_id,
    clientSecret: oauthDefinition?.clientSecret ?? profile.client_secret,
    tokenEndpointAuthMethod:
      oauthDefinition?.tokenEndpointAuthMethod ?? profile.token_endpoint_auth_method,
    authorizationEndpointOverride:
      oauthDefinition?.authorizationEndpointOverride ?? profile.authorization_endpoint,
    tokenEndpointOverride:
      oauthDefinition?.tokenEndpointOverride ?? profile.token_endpoint,
    registrationEndpointOverride:
      oauthDefinition?.registrationEndpointOverride ?? profile.registration_endpoint,
    deviceAuthorizationEndpointOverride:
      oauthDefinition?.deviceAuthorizationEndpointOverride ?? profile.device_authorization_endpoint,
    scopes:
      oauthDefinition?.scopes && oauthDefinition.scopes.length > 0
        ? oauthDefinition.scopes
        : profile.default_scopes,
    resourceIndicators:
      oauthDefinition?.resourceIndicators && oauthDefinition.resourceIndicators.length > 0
        ? oauthDefinition.resourceIndicators
        : profile.default_resource_indicators,
    audiences:
      oauthDefinition?.audiences && oauthDefinition.audiences.length > 0
        ? oauthDefinition.audiences
        : profile.default_audiences,
  };
}

function persistableOauthConfig(
  value: RemoteMcpOAuthConfigRecord,
): RemoteMcpOAuthConfigRecord {
  return {
    ...value,
    clientSecret: value.clientSecret
      ? isRemoteMcpSecretEncrypted(value.clientSecret)
        ? value.clientSecret
        : encryptRemoteMcpSecret(value.clientSecret)
      : null,
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

function selectAuthorizeQueryParameters(
  parameters: RemoteMcpParameterInput[],
): Array<{ key: string; value: string }> {
  return parameters.flatMap((parameter) => {
    if (parameter.placement !== 'authorize_request_query') {
      return [];
    }
    const value = parameter.value.trim();
    return value ? [{ key: parameter.key, value }] : [];
  });
}

function resolveEffectiveGrantType(
  oauthDefinition: RemoteMcpOauthDefinition | null,
): 'authorization_code' | 'device_authorization' | 'client_credentials' {
  const grantType = oauthDefinition?.grantType ?? 'authorization_code';
  if (grantType === 'client_credentials' || grantType === 'device_authorization') {
    return grantType;
  }
  if (grantType === 'enterprise_managed_authorization') {
    const enterpriseGrantType = readString(oauthDefinition?.enterpriseProfile?.grant_type);
    if (enterpriseGrantType === 'client_credentials' || enterpriseGrantType === 'device_authorization') {
      return enterpriseGrantType;
    }
  }
  return 'authorization_code';
}
