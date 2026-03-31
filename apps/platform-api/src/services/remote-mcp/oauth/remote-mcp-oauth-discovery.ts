import { ValidationError } from '../../../errors/domain-errors.js';
import type { RemoteMcpOauthDefinition } from '../core/remote-mcp-model.js';

const CALLBACK_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const CLIENT_METADATA_PATH = '/.well-known/oauth/mcp-client.json';
const HOSTED_CALLBACK_PATH = '/api/v1/oauth/callback';

export interface ResourceMetadata {
  resource: string;
  authorizationServers: string[];
}

export interface ResourceDiscoveryResult {
  metadata: ResourceMetadata;
  strategy: string;
}

export interface AuthorizationServerMetadata {
  issuer: string | null;
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  registrationEndpoint: string | null;
  deviceAuthorizationEndpoint: string | null;
  pushedAuthorizationRequestEndpoint: string | null;
  tokenEndpointAuthMethodsSupported: string[];
  codeChallengeMethodsSupported: string[];
  clientIdMetadataDocumentSupported: boolean;
  grantTypesSupported: string[];
}

export interface AuthorizationServerDiscoveryResult {
  metadata: AuthorizationServerMetadata;
  strategy: string;
}

export function assertOAuthEndpointUrl(value: string): void {
  const parsed = new URL(value);
  if (parsed.search || parsed.hash) {
    throw new ValidationError('Remote MCP endpoint URL must not include a query string or fragment');
  }
}

export async function discoverResourceMetadata(input: {
  endpointUrl: string;
  oauthDefinition: RemoteMcpOauthDefinition | null;
  fetcher?: typeof fetch;
}): Promise<ResourceDiscoveryResult> {
  const fetcher = input.fetcher ?? fetch;
  const override = input.oauthDefinition?.protectedResourceMetadataUrlOverride?.trim();
  if (override) {
    return {
      metadata: await fetchProtectedResourceMetadata(fetcher, override, input.endpointUrl),
      strategy: 'operator_override_protected_resource_metadata',
    };
  }

  const challengeMetadataUrl = await discoverChallengeMetadataUrl(fetcher, input.endpointUrl);
  if (challengeMetadataUrl) {
    return {
      metadata: await fetchProtectedResourceMetadata(fetcher, challengeMetadataUrl, input.endpointUrl),
      strategy: 'challenge_resource_metadata',
    };
  }

  for (const candidate of buildProtectedResourceMetadataCandidates(input.endpointUrl)) {
    const strategy = classifyProtectedResourceMetadataCandidate(input.endpointUrl, candidate);
    const metadata = await tryFetchProtectedResourceMetadata(fetcher, candidate, input.endpointUrl);
    if (metadata) {
      return { metadata, strategy };
    }
  }

  return {
    metadata: {
      resource: input.endpointUrl,
      authorizationServers: [],
    },
    strategy: 'none',
  };
}

export async function discoverAuthorizationServerMetadata(input: {
  endpointUrl: string;
  resourceDiscovery: ResourceDiscoveryResult;
  oauthDefinition: RemoteMcpOauthDefinition | null;
  fetcher?: typeof fetch;
}): Promise<AuthorizationServerDiscoveryResult> {
  const fetcher = input.fetcher ?? fetch;
  if (input.oauthDefinition?.authorizationEndpointOverride && input.oauthDefinition?.tokenEndpointOverride) {
    return {
      strategy: 'operator_override_endpoints',
      metadata: {
        issuer: null,
        authorizationEndpoint: input.oauthDefinition.authorizationEndpointOverride,
        tokenEndpoint: input.oauthDefinition.tokenEndpointOverride,
        registrationEndpoint: input.oauthDefinition.registrationEndpointOverride ?? null,
        deviceAuthorizationEndpoint: input.oauthDefinition.deviceAuthorizationEndpointOverride ?? null,
        pushedAuthorizationRequestEndpoint: null,
        tokenEndpointAuthMethodsSupported: [],
        codeChallengeMethodsSupported: ['S256'],
        clientIdMetadataDocumentSupported: false,
        grantTypesSupported: [],
      },
    };
  }

  const metadataOverride = input.oauthDefinition?.authorizationServerMetadataUrlOverride?.trim();
  if (metadataOverride) {
    return {
      strategy: 'operator_override_authorization_server_metadata',
      metadata: await fetchAuthorizationServerMetadata(fetcher, metadataOverride),
    };
  }

  for (const authorizationServerUrl of input.resourceDiscovery.metadata.authorizationServers) {
    for (const candidate of buildAuthorizationServerMetadataCandidates(authorizationServerUrl)) {
      const metadata = await tryFetchAuthorizationServerMetadata(fetcher, candidate);
      if (metadata) {
        return {
          metadata,
          strategy: classifyAuthorizationServerMetadataCandidate(authorizationServerUrl, candidate),
        };
      }
    }
  }

  for (const candidate of buildEndpointAuthorizationServerMetadataCandidates(input.endpointUrl)) {
    const metadata = await tryFetchAuthorizationServerMetadata(fetcher, candidate);
    if (metadata) {
      return {
        metadata,
        strategy: classifyEndpointAuthorizationServerMetadataCandidate(input.endpointUrl, candidate),
      };
    }
  }

  throw new ValidationError('Remote MCP authorization metadata discovery failed');
}

export function buildClientMetadataUrl(platformPublicBaseUrl: string): string {
  return new URL(CLIENT_METADATA_PATH, platformPublicBaseUrl).toString();
}

export function buildRemoteMcpRedirectUri(
  callbackMode: 'loopback' | 'hosted_https',
  hostedCallbackBaseUrl: string | undefined,
): string {
  if (callbackMode === 'hosted_https') {
    if (!hostedCallbackBaseUrl || hostedCallbackBaseUrl.trim().length === 0) {
      throw new ValidationError('Remote MCP hosted callback mode requires a hosted callback base URL');
    }
    return new URL(HOSTED_CALLBACK_PATH, hostedCallbackBaseUrl.trim()).toString();
  }
  return CALLBACK_REDIRECT_URI;
}

export function resolveRemoteMcpCallbackMode(
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

export function buildAuthorizeUrl(
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
    extraQueryParameters: Array<{ key: string; value: string }>;
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

async function discoverChallengeMetadataUrl(
  fetcher: typeof fetch,
  endpointUrl: string,
): Promise<string | null> {
  const response = await fetcher(endpointUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/event-stream',
    },
  });
  return readResourceMetadataFromWwwAuthenticate(response.headers.get('www-authenticate'));
}

async function tryFetchProtectedResourceMetadata(
  fetcher: typeof fetch,
  metadataUrl: string,
  defaultResource: string,
): Promise<ResourceMetadata | null> {
  const response = await fetcher(metadataUrl, {
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    return null;
  }
  return parseProtectedResourceMetadata(response, defaultResource);
}

async function fetchProtectedResourceMetadata(
  fetcher: typeof fetch,
  metadataUrl: string,
  defaultResource: string,
): Promise<ResourceMetadata> {
  const metadata = await tryFetchProtectedResourceMetadata(fetcher, metadataUrl, defaultResource);
  if (!metadata) {
    throw new ValidationError('Remote MCP OAuth discovery failed');
  }
  return metadata;
}

async function parseProtectedResourceMetadata(
  response: Response,
  defaultResource: string,
): Promise<ResourceMetadata> {
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
      : defaultResource,
    authorizationServers,
  };
}

async function tryFetchAuthorizationServerMetadata(
  fetcher: typeof fetch,
  metadataUrl: string,
): Promise<AuthorizationServerMetadata | null> {
  const response = await fetcher(metadataUrl, {
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    return null;
  }
  return parseAuthorizationServerMetadata(response);
}

async function fetchAuthorizationServerMetadata(
  fetcher: typeof fetch,
  metadataUrl: string,
): Promise<AuthorizationServerMetadata> {
  const metadata = await tryFetchAuthorizationServerMetadata(fetcher, metadataUrl);
  if (!metadata) {
    throw new ValidationError('Remote MCP authorization metadata discovery failed');
  }
  return metadata;
}

async function parseAuthorizationServerMetadata(
  response: Response,
): Promise<AuthorizationServerMetadata> {
  const payload = await response.json() as Record<string, unknown>;
  return {
    issuer: readString(payload.issuer),
    authorizationEndpoint: readString(payload.authorization_endpoint),
    tokenEndpoint: readString(payload.token_endpoint),
    registrationEndpoint: readString(payload.registration_endpoint),
    deviceAuthorizationEndpoint: readString(payload.device_authorization_endpoint),
    pushedAuthorizationRequestEndpoint: readString(payload.pushed_authorization_request_endpoint),
    tokenEndpointAuthMethodsSupported: normalizeStringList(payload.token_endpoint_auth_methods_supported),
    codeChallengeMethodsSupported: normalizeStringList(payload.code_challenge_methods_supported),
    clientIdMetadataDocumentSupported: payload.client_id_metadata_document_supported === true,
    grantTypesSupported: normalizeStringList(payload.grant_types_supported),
  };
}

function readResourceMetadataFromWwwAuthenticate(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const match = /resource_metadata="([^"]+)"/i.exec(value);
  return match?.[1]?.trim() || null;
}

function buildProtectedResourceMetadataCandidates(endpointUrl: string): string[] {
  const endpoint = new URL(endpointUrl);
  const rawPath = endpoint.pathname;
  const normalizedPath = rawPath.replace(/\/+$/, '');
  const rootPrefixed = normalizedPath
    ? new URL(`/.well-known/oauth-protected-resource${normalizedPath}`, endpoint.origin).toString()
    : new URL('/.well-known/oauth-protected-resource', endpoint.origin).toString();
  const pathScoped = normalizedPath
    ? new URL(`${normalizedPath}/.well-known/oauth-protected-resource`, endpoint.origin).toString()
    : new URL('/.well-known/oauth-protected-resource', endpoint.origin).toString();
  return Array.from(new Set([rootPrefixed, pathScoped]));
}

function buildAuthorizationServerMetadataCandidates(authorizationServerUrl: string): string[] {
  const authorizationServer = new URL(authorizationServerUrl);
  const normalizedPath = authorizationServer.pathname.replace(/\/+$/, '');
  const pathScopedOidc = normalizedPath
    ? new URL(`${normalizedPath}/.well-known/openid-configuration`, authorizationServer.origin).toString()
    : null;
  const pathScopedOAuth = normalizedPath
    ? new URL(`${normalizedPath}/.well-known/oauth-authorization-server`, authorizationServer.origin).toString()
    : null;
  return [pathScopedOidc, pathScopedOAuth,
    new URL('/.well-known/openid-configuration', authorizationServer.origin).toString(),
    new URL('/.well-known/oauth-authorization-server', authorizationServer.origin).toString(),
  ].filter((value): value is string => Boolean(value));
}

function buildEndpointAuthorizationServerMetadataCandidates(endpointUrl: string): string[] {
  const endpoint = new URL(endpointUrl);
  const normalizedPath = endpoint.pathname.replace(/\/+$/, '');
  return [
    normalizedPath
      ? new URL(`${normalizedPath}/.well-known/oauth-authorization-server`, endpoint.origin).toString()
      : null,
    new URL('/.well-known/oauth-authorization-server', endpoint.origin).toString(),
  ].filter((value): value is string => Boolean(value));
}

function classifyProtectedResourceMetadataCandidate(endpointUrl: string, candidate: string): string {
  const endpoint = new URL(endpointUrl);
  const normalizedPath = endpoint.pathname.replace(/\/+$/, '');
  return candidate.includes(`/.well-known/oauth-protected-resource${normalizedPath}`)
    ? 'protected_resource_root_prefix'
    : 'protected_resource_path_scoped';
}

function classifyAuthorizationServerMetadataCandidate(authorizationServerUrl: string, candidate: string): string {
  const authorizationServer = new URL(authorizationServerUrl);
  const normalizedPath = authorizationServer.pathname.replace(/\/+$/, '');
  if (normalizedPath && candidate.includes(`${normalizedPath}/.well-known/openid-configuration`)) {
    return 'authorization_server_path_scoped_oidc';
  }
  if (normalizedPath && candidate.includes(`${normalizedPath}/.well-known/oauth-authorization-server`)) {
    return 'authorization_server_path_scoped_oauth';
  }
  if (candidate.includes('/.well-known/openid-configuration')) {
    return 'authorization_server_root_oidc';
  }
  return 'authorization_server_root_oauth';
}

function classifyEndpointAuthorizationServerMetadataCandidate(endpointUrl: string, candidate: string): string {
  const endpoint = new URL(endpointUrl);
  const normalizedPath = endpoint.pathname.replace(/\/+$/, '');
  return normalizedPath && candidate.includes(`${normalizedPath}/.well-known/oauth-authorization-server`)
    ? 'endpoint_path_scoped_authorization_server'
    : 'endpoint_root_authorization_server';
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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
