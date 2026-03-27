import { ValidationError } from '../errors/domain-errors.js';
import type {
  RemoteMcpOauthDefinition,
  RemoteMcpParameterInput,
} from './remote-mcp-model.js';
import {
  REMOTE_MCP_STORED_SECRET_VALUE,
  normalizeStoredRemoteMcpSecret,
} from './remote-mcp-secret-crypto.js';

export function resolvePersistedParameterSecret(
  parameter: Pick<RemoteMcpParameterInput, 'id' | 'valueKind' | 'value'>,
  existingSecrets: ReadonlyMap<string, string>,
): string | null {
  if (parameter.valueKind !== 'secret') {
    return null;
  }

  const value = parameter.value.trim();
  if (value === REMOTE_MCP_STORED_SECRET_VALUE) {
    const parameterId = parameter.id?.trim();
    if (!parameterId) {
      throw new ValidationError('Stored remote MCP secrets can only be preserved when the parameter id is included.');
    }
    const existingSecret = existingSecrets.get(parameterId);
    if (!existingSecret) {
      throw new ValidationError('Stored remote MCP secret could not be resolved for update.');
    }
    return existingSecret;
  }

  return normalizeStoredRemoteMcpSecret(value);
}

export function resolvePersistedOauthDefinition(
  next: RemoteMcpOauthDefinition | null | undefined,
  current: RemoteMcpOauthDefinition | null,
): RemoteMcpOauthDefinition | null {
  if (next === undefined) {
    return persistOauthDefinitionSecrets(current, null);
  }
  if (next === null) {
    return null;
  }

  return {
    grantType: next.grantType ?? current?.grantType,
    clientStrategy: next.clientStrategy ?? current?.clientStrategy,
    callbackMode: next.callbackMode ?? current?.callbackMode,
    clientId: next.clientId ?? current?.clientId ?? null,
    clientSecret: resolveOauthSecretField(next.clientSecret, current?.clientSecret ?? null),
    tokenEndpointAuthMethod:
      next.tokenEndpointAuthMethod ?? current?.tokenEndpointAuthMethod,
    authorizationEndpointOverride:
      next.authorizationEndpointOverride ?? current?.authorizationEndpointOverride ?? null,
    tokenEndpointOverride:
      next.tokenEndpointOverride ?? current?.tokenEndpointOverride ?? null,
    registrationEndpointOverride:
      next.registrationEndpointOverride ?? current?.registrationEndpointOverride ?? null,
    deviceAuthorizationEndpointOverride:
      next.deviceAuthorizationEndpointOverride ?? current?.deviceAuthorizationEndpointOverride ?? null,
    protectedResourceMetadataUrlOverride:
      next.protectedResourceMetadataUrlOverride ?? current?.protectedResourceMetadataUrlOverride ?? null,
    authorizationServerMetadataUrlOverride:
      next.authorizationServerMetadataUrlOverride ?? current?.authorizationServerMetadataUrlOverride ?? null,
    scopes: next.scopes ?? current?.scopes ?? [],
    resourceIndicators: next.resourceIndicators ?? current?.resourceIndicators ?? [],
    audiences: next.audiences ?? current?.audiences ?? [],
    enterpriseProfile: next.enterpriseProfile ?? current?.enterpriseProfile ?? null,
    parMode: next.parMode ?? current?.parMode,
    jarMode: next.jarMode ?? current?.jarMode,
    privateKeyPem: resolveOauthSecretField(next.privateKeyPem, current?.privateKeyPem ?? null),
  };
}

export function persistOauthDefinitionSecrets(
  value: RemoteMcpOauthDefinition | null,
  current: RemoteMcpOauthDefinition | null,
): RemoteMcpOauthDefinition | null {
  if (!value) {
    return null;
  }

  return {
    ...value,
    clientSecret: resolveOauthSecretField(value.clientSecret, current?.clientSecret ?? null),
    privateKeyPem: resolveOauthSecretField(value.privateKeyPem, current?.privateKeyPem ?? null),
  };
}

function resolveOauthSecretField(
  nextValue: string | null | undefined,
  currentValue: string | null,
): string | null {
  if (nextValue === undefined) {
    return currentValue ? normalizeStoredRemoteMcpSecret(currentValue) : null;
  }
  if (nextValue === null) {
    return null;
  }

  const value = nextValue.trim();
  if (!value) {
    return currentValue ? normalizeStoredRemoteMcpSecret(currentValue) : null;
  }
  if (value === REMOTE_MCP_STORED_SECRET_VALUE) {
    return currentValue ? normalizeStoredRemoteMcpSecret(currentValue) : null;
  }
  return normalizeStoredRemoteMcpSecret(value);
}
