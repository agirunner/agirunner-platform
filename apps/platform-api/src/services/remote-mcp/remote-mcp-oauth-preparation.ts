import { ValidationError } from '../../errors/domain-errors.js';
import { generateCodeChallenge, generateCodeVerifier, generateState } from '../../lib/pkce.js';
import type {
  RemoteMcpOAuthConfigRecord,
  RemoteMcpOauthDefinition,
  RemoteMcpParameterInput,
} from '../remote-mcp-model.js';
import { buildOauthClientConfig } from '../remote-mcp-oauth-client.js';
import {
  assertOAuthEndpointUrl,
  buildAuthorizeUrl,
  buildRemoteMcpRedirectUri,
  discoverAuthorizationServerMetadata,
  discoverResourceMetadata,
  resolveRemoteMcpCallbackMode,
} from '../remote-mcp-oauth-discovery.js';
import {
  readMissingAuthorizationEndpointMessage,
  readMissingDeviceAuthorizationEndpointMessage,
} from '../remote-mcp-oauth-errors.js';
import {
  exchangeClientCredentialsToken,
  requestDeviceAuthorization,
} from '../remote-mcp-oauth-http.js';
import type {
  DeviceAuthorizationFlow,
  PreparedOAuthFlow,
  TokenResponse,
} from '../remote-mcp-oauth-types.js';
import type { RemoteMcpOAuthClientProfileRecord } from '../remote-mcp-oauth-client-profile-service.js';
import {
  mergeOauthDefinitionWithClientProfile,
  requirePlatformPublicBaseUrl,
  resolveEffectiveGrantType,
  selectAuthorizeQueryParameters,
} from './remote-mcp-oauth-helpers.js';

interface RemoteMcpOauthPreparationInput {
  tenantId: string;
  endpointUrl: string;
  oauthClientProfileId: string | null;
  oauthDefinition: RemoteMcpOauthDefinition | null;
  parameters: RemoteMcpParameterInput[];
}

interface RemoteMcpOauthPreparationDeps {
  platformPublicBaseUrl?: string;
  remoteMcpHostedCallbackBaseUrl?: string;
  oauthClientProfileService?: {
    getStoredProfile(tenantId: string, id: string): Promise<RemoteMcpOAuthClientProfileRecord>;
  };
}

export async function prepareBrowserAuthorization(
  input: RemoteMcpOauthPreparationInput,
  deps: RemoteMcpOauthPreparationDeps,
): Promise<PreparedOAuthFlow> {
  const oauthDefinition = await resolveEffectiveOauthDefinition(input, deps);
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
    deps.remoteMcpHostedCallbackBaseUrl,
  );
  const redirectUri = buildRemoteMcpRedirectUri(
    callbackMode,
    deps.remoteMcpHostedCallbackBaseUrl,
  );
  const clientConfig = await buildOauthClientConfig({
    metadata: authDiscovery.metadata,
    resource: resourceDiscovery.metadata.resource,
    redirectUri,
    oauthDefinition,
    platformPublicBaseUrl: requirePlatformPublicBaseUrl(deps.platformPublicBaseUrl),
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

export async function prepareDeviceAuthorization(
  input: RemoteMcpOauthPreparationInput,
  deps: RemoteMcpOauthPreparationDeps,
): Promise<DeviceAuthorizationFlow> {
  const oauthDefinition = await resolveEffectiveOauthDefinition(input, deps);
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
    resolveRemoteMcpCallbackMode(oauthDefinition?.callbackMode, deps.remoteMcpHostedCallbackBaseUrl),
    deps.remoteMcpHostedCallbackBaseUrl,
  );
  const clientConfig = await buildOauthClientConfig({
    metadata: authDiscovery.metadata,
    resource: resourceDiscovery.metadata.resource,
    redirectUri,
    oauthDefinition,
    platformPublicBaseUrl: requirePlatformPublicBaseUrl(deps.platformPublicBaseUrl),
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

export async function requestClientCredentialsToken(
  input: RemoteMcpOauthPreparationInput,
  deps: RemoteMcpOauthPreparationDeps,
): Promise<{
  oauthConfig: RemoteMcpOAuthConfigRecord;
  token: TokenResponse;
  discoveryStrategy: string;
  oauthStrategy: string;
}> {
  const effectiveOauthDefinition = await resolveEffectiveOauthDefinition(input, deps);
  assertOAuthEndpointUrl(input.endpointUrl);
  const resourceDiscovery = await discoverResourceMetadata({
    endpointUrl: input.endpointUrl,
    oauthDefinition: effectiveOauthDefinition,
  });
  const authDiscovery = await discoverAuthorizationServerMetadata({
    endpointUrl: input.endpointUrl,
    resourceDiscovery,
    oauthDefinition: effectiveOauthDefinition,
  });
  const redirectUri = buildRemoteMcpRedirectUri(
    resolveRemoteMcpCallbackMode(effectiveOauthDefinition?.callbackMode, deps.remoteMcpHostedCallbackBaseUrl),
    deps.remoteMcpHostedCallbackBaseUrl,
  );
  const oauthConfig = await buildOauthClientConfig({
    metadata: authDiscovery.metadata,
    resource: resourceDiscovery.metadata.resource,
    redirectUri,
    oauthDefinition: effectiveOauthDefinition,
    platformPublicBaseUrl: requirePlatformPublicBaseUrl(deps.platformPublicBaseUrl),
  });
  const token = await exchangeClientCredentialsToken(oauthConfig, input.parameters);
  return {
    oauthConfig,
    token,
    discoveryStrategy: `${resourceDiscovery.strategy}+${authDiscovery.strategy}`,
    oauthStrategy: resolveEffectiveGrantType(effectiveOauthDefinition),
  };
}

async function resolveEffectiveOauthDefinition(
  input: Pick<RemoteMcpOauthPreparationInput, 'tenantId' | 'oauthClientProfileId' | 'oauthDefinition'>,
  deps: Pick<RemoteMcpOauthPreparationDeps, 'oauthClientProfileService'>,
): Promise<RemoteMcpOauthDefinition | null> {
  if (!input.oauthClientProfileId) {
    return input.oauthDefinition;
  }
  if (!deps.oauthClientProfileService) {
    throw new ValidationError('Remote MCP OAuth client profile support is not configured');
  }
  const profile = await deps.oauthClientProfileService.getStoredProfile(input.tenantId, input.oauthClientProfileId);
  return mergeOauthDefinitionWithClientProfile(input.oauthDefinition, profile);
}
