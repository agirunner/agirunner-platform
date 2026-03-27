import type { RemoteMcpOauthDefinition } from './remote-mcp-model.js';

export function readMissingTokenEndpointMessage(
  oauthDefinition: RemoteMcpOauthDefinition | null,
): string {
  return usesAutomaticOauthDiscovery(oauthDefinition)
    ? 'Automatic OAuth discovery did not provide usable authorization and token endpoints. Configure a manual OAuth client and endpoint overrides for this server.'
    : 'Remote MCP OAuth configuration is missing a token endpoint.';
}

export function readMissingAuthorizationEndpointMessage(
  oauthDefinition: RemoteMcpOauthDefinition | null,
): string {
  return usesAutomaticOauthDiscovery(oauthDefinition)
    ? 'Automatic OAuth discovery did not provide usable authorization and token endpoints. Configure a manual OAuth client and endpoint overrides for this server.'
    : 'Remote MCP OAuth configuration is missing an authorization endpoint.';
}

export function readMissingDeviceAuthorizationEndpointMessage(
  oauthDefinition: RemoteMcpOauthDefinition | null,
): string {
  return usesAutomaticOauthDiscovery(oauthDefinition)
    ? 'Automatic OAuth discovery did not provide a usable device authorization endpoint. Configure a manual OAuth client and endpoint overrides for this server.'
    : 'Remote MCP OAuth configuration is missing a device authorization endpoint.';
}

function usesAutomaticOauthDiscovery(
  oauthDefinition: RemoteMcpOauthDefinition | null,
): boolean {
  if (!oauthDefinition) {
    return true;
  }
  if ((oauthDefinition.clientStrategy ?? 'auto') !== 'auto') {
    return false;
  }
  return !oauthDefinition.clientId
    && !oauthDefinition.authorizationEndpointOverride
    && !oauthDefinition.tokenEndpointOverride
    && !oauthDefinition.deviceAuthorizationEndpointOverride
    && !oauthDefinition.authorizationServerMetadataUrlOverride;
}
