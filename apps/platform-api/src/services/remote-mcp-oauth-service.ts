import type { DatabaseQueryable } from '../db/database.js';
import { ValidationError } from '../errors/domain-errors.js';
import type {
  CreateVerifiedRemoteMcpServerInput,
  StoredRemoteMcpServerRecord,
  UpdateVerifiedRemoteMcpServerInput,
} from './remote-mcp-server-service.js';
import {
  type RemoteMcpOAuthConfigRecord,
  type RemoteMcpOAuthCredentialsRecord,
} from './remote-mcp-model.js';
import {
  exchangeAuthorizationCodeToken,
  pollDeviceAuthorizationToken,
} from './remote-mcp-oauth-http.js';
import {
  remoteMcpOAuthStatePayloadSchema,
  type RemoteMcpOAuthStartResult,
} from './remote-mcp-oauth-types.js';
import type { RemoteMcpVerifier } from './remote-mcp-verification-service.js';
import type { RemoteMcpOAuthClientProfileRecord } from './remote-mcp-oauth-client-profile-service.js';
import {
  buildCreateVerifiedServerInput,
  buildUpdateVerifiedServerInput,
  verifyConnectedServer,
} from './remote-mcp/remote-mcp-oauth-finalization.js';
import {
  buildStoredOauthCredentials,
  parseDraftParameters,
  resolveEffectiveGrantType,
} from './remote-mcp/remote-mcp-oauth-helpers.js';
import {
  resolveStoredAuthorizationSecret,
  resolveVerificationAuthorizationValue,
  type AuthorizationSecretInput,
} from './remote-mcp/remote-mcp-oauth-credentials.js';
import {
  prepareBrowserAuthorization,
  prepareDeviceAuthorization,
  requestClientCredentialsToken,
} from './remote-mcp/remote-mcp-oauth-preparation.js';
import {
  consumeState,
  createOAuthDraft,
  deleteDraft,
  deleteState,
  draftInputSchema,
  loadDraft,
  loadServerAsDraft,
  loadState,
  type DraftInput,
  insertOAuthState,
} from './remote-mcp/remote-mcp-oauth-store.js';

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

    const draftId = await createOAuthDraft(this.pool, tenantId, userId, validated);

    if (effectiveGrantType === 'device_authorization') {
      const flow = await prepareDeviceAuthorization({
        tenantId,
        endpointUrl: validated.endpointUrl.trim(),
        oauthClientProfileId: validated.oauthClientProfileId ?? null,
        oauthDefinition: validated.oauthDefinition ?? null,
        parameters: validated.parameters,
      }, this.optionsWithProfiles());
      await insertOAuthState(this.pool, tenantId, userId, flow.state, '', {
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

    const flow = await prepareBrowserAuthorization({
      tenantId,
      endpointUrl: validated.endpointUrl.trim(),
      oauthClientProfileId: validated.oauthClientProfileId ?? null,
      oauthDefinition: validated.oauthDefinition ?? null,
      parameters: validated.parameters,
    }, this.optionsWithProfiles());
    await insertOAuthState(this.pool, tenantId, userId, flow.state, flow.codeVerifier, {
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
      const flow = await prepareDeviceAuthorization({
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
      }, this.optionsWithProfiles());
      await insertOAuthState(this.pool, tenantId, userId, flow.state, '', {
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
    const flow = await prepareBrowserAuthorization({
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
    }, this.optionsWithProfiles());
    await insertOAuthState(this.pool, tenantId, userId, flow.state, flow.codeVerifier, {
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
    const stateRow = await consumeState(this.pool, state);
    if (stateRow.flow_kind !== 'remote_mcp') {
      throw new ValidationError('OAuth state does not belong to a remote MCP flow');
    }
    const payload = remoteMcpOAuthStatePayloadSchema.parse(stateRow.flow_payload);
    const token = await exchangeAuthorizationCodeToken(payload.oauth_config, code, stateRow.code_verifier);
    const draft = payload.mode === 'draft'
      ? await loadDraft(this.pool, stateRow.tenant_id, payload.draft_id ?? '')
      : await loadServerAsDraft(this.serverService, stateRow.tenant_id, payload.server_id ?? '');
    const verification = await verifyConnectedServer(this.verifier, draft, token.access_token);

    if (payload.mode === 'draft') {
      const created = await this.serverService.createVerifiedServer(
        stateRow.tenant_id,
        buildCreateVerifiedServerInput({
          tenantId: stateRow.tenant_id,
          userId: stateRow.user_id,
          draft,
          oauthConfig: payload.oauth_config,
          token,
          discoveryStrategy: payload.discovery_strategy,
          oauthStrategy: payload.oauth_strategy,
          verification,
        }),
      );
      await deleteDraft(this.pool, draft.id);
      return {
        serverId: created.id,
        serverName: created.name,
      };
    }

    const updated = await this.serverService.updateVerifiedServer(
      stateRow.tenant_id,
      payload.server_id ?? '',
      buildUpdateVerifiedServerInput({
        tenantId: stateRow.tenant_id,
        userId: stateRow.user_id,
        draft,
        oauthConfig: payload.oauth_config,
        token,
        discoveryStrategy: payload.discovery_strategy,
        oauthStrategy: payload.oauth_strategy,
        verification,
      }),
    );
    return {
      serverId: updated.id,
      serverName: updated.name,
    };
  }

  async pollDeviceAuthorization(
    deviceFlowId: string,
  ): Promise<RemoteMcpOAuthStartResult> {
    const stateRow = await loadState(this.pool, deviceFlowId);
    if (stateRow.flow_kind !== 'remote_mcp') {
      throw new ValidationError('OAuth state does not belong to a remote MCP flow');
    }
    const payload = remoteMcpOAuthStatePayloadSchema.parse(stateRow.flow_payload);
    const deviceAuthorization = payload.device_authorization;
    if (!deviceAuthorization) {
      throw new ValidationError('Remote MCP OAuth state is not a device authorization flow');
    }
    const draft = payload.mode === 'draft'
      ? await loadDraft(this.pool, stateRow.tenant_id, payload.draft_id ?? '')
      : await loadServerAsDraft(this.serverService, stateRow.tenant_id, payload.server_id ?? '');
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
    await deleteState(this.pool, deviceFlowId);
    const verification = await verifyConnectedServer(this.verifier, draft, pollResult.token.access_token);

    if (payload.mode === 'draft') {
      const created = await this.serverService.createVerifiedServer(
        stateRow.tenant_id,
        buildCreateVerifiedServerInput({
          tenantId: stateRow.tenant_id,
          userId: stateRow.user_id,
          draft,
          oauthConfig: payload.oauth_config,
          token: pollResult.token,
          discoveryStrategy: payload.discovery_strategy,
          oauthStrategy: payload.oauth_strategy,
          verification,
        }),
      );
      await deleteDraft(this.pool, draft.id);
      return {
        kind: 'completed',
        serverId: created.id,
        serverName: created.name,
      };
    }

    const updated = await this.serverService.updateVerifiedServer(
      stateRow.tenant_id,
      payload.server_id ?? '',
      buildUpdateVerifiedServerInput({
        tenantId: stateRow.tenant_id,
        userId: stateRow.user_id,
        draft,
        oauthConfig: payload.oauth_config,
        token: pollResult.token,
        discoveryStrategy: payload.discovery_strategy,
        oauthStrategy: payload.oauth_strategy,
        verification,
      }),
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

  async resolveStoredAuthorizationSecret(server: AuthorizationSecretInput): Promise<string> {
    return resolveStoredAuthorizationSecret(this.pool, server);
  }

  async resolveVerificationAuthorizationValue(server: AuthorizationSecretInput): Promise<string> {
    return resolveVerificationAuthorizationValue(this.pool, server);
  }

  private async completeClientCredentialsDraft(
    tenantId: string,
    userId: string,
    draft: Awaited<ReturnType<typeof draftInputSchema.parse>>,
  ): Promise<RemoteMcpOAuthStartResult> {
    const token = await requestClientCredentialsToken({
      tenantId,
      endpointUrl: draft.endpointUrl.trim(),
      oauthClientProfileId: draft.oauthClientProfileId ?? null,
      oauthDefinition: draft.oauthDefinition ?? null,
      parameters: draft.parameters,
    }, this.optionsWithProfiles());
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
      oauthConfig: token.oauthConfig,
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
    const draft = await loadServerAsDraft(this.serverService, tenantId, current.id);
    const token = await requestClientCredentialsToken({
      tenantId,
      endpointUrl: draft.endpoint_url,
      oauthClientProfileId: draft.oauth_client_profile_id,
      oauthDefinition: current.oauth_definition,
      parameters: parseDraftParameters(draft.parameters),
    }, this.optionsWithProfiles());
    const verification = await verifyConnectedServer(this.verifier, draft, token.token.access_token);
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
      oauthConfig: token.oauthConfig,
      oauthCredentials: buildStoredOauthCredentials(token.token, userId),
    });
    return {
      kind: 'completed',
      serverId: updated.id,
      serverName: updated.name,
    };
  }

  private optionsWithProfiles() { return { ...this.options, oauthClientProfileService: this.oauthClientProfileService }; }
}
