import { ValidationError } from '../errors/domain-errors.js';
import {
  type RemoteMcpOAuthConfigRecord,
  type RemoteMcpParameterInput,
} from './remote-mcp-model.js';
import { decryptRemoteMcpSecret } from './remote-mcp-secret-crypto.js';
import {
  parseDeviceAuthorizationResponse,
  parseTokenResponse,
  readOAuthResponseBody,
} from './remote-mcp-oauth-http-response.js';
import type {
  DeviceAuthorizationPollResult,
  DeviceAuthorizationResponse,
  TokenResponse,
} from './remote-mcp-oauth-types.js';

export async function exchangeAuthorizationCodeToken(
  oauthConfig: RemoteMcpOAuthConfigRecord,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  return postTokenRequest(oauthConfig, {
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: oauthConfig.redirectUri,
    client_id: oauthConfig.clientId,
    scope: oauthConfig.scopes.length > 0 ? oauthConfig.scopes.join(' ') : undefined,
  });
}

export async function exchangeClientCredentialsToken(
  oauthConfig: RemoteMcpOAuthConfigRecord,
  parameters: RemoteMcpParameterInput[],
): Promise<TokenResponse> {
  const resources = oauthConfig.resourceIndicators.length > 0
    ? oauthConfig.resourceIndicators
    : [oauthConfig.resource];
  return postTokenRequest(
    oauthConfig,
    {
      grant_type: 'client_credentials',
      client_id: oauthConfig.clientId,
      scope: oauthConfig.scopes.length > 0 ? oauthConfig.scopes.join(' ') : undefined,
    },
    parameters,
    resources,
    oauthConfig.audiences,
  );
}

export async function refreshRemoteMcpAccessToken(
  oauthConfig: RemoteMcpOAuthConfigRecord,
  refreshTokenSecret: string,
): Promise<TokenResponse> {
  return postTokenRequest(oauthConfig, {
    grant_type: 'refresh_token',
    refresh_token: decryptRemoteMcpSecret(refreshTokenSecret),
    client_id: oauthConfig.clientId,
  });
}

export async function requestDeviceAuthorization(
  oauthConfig: RemoteMcpOAuthConfigRecord,
  parameters: RemoteMcpParameterInput[],
): Promise<DeviceAuthorizationResponse> {
  if (!oauthConfig.deviceAuthorizationEndpoint) {
    throw new ValidationError('Remote MCP authorization server does not expose a device authorization endpoint');
  }

  const bodyKind = hasPlacement(parameters, 'device_request_body_json')
    ? 'json'
    : 'form';
  const headers = {
    ...toHeaderMap(selectParameters(parameters, 'device_request_header')),
  };

  const endpoint = appendQueryParameters(
    oauthConfig.deviceAuthorizationEndpoint,
    selectParameters(parameters, 'device_request_query'),
  );

  if (bodyKind === 'json') {
    const payload = buildDeviceJsonPayload(oauthConfig, parameters);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(payload),
    });
    return parseDeviceAuthorizationResponse(response);
  }

  const form = buildDeviceFormPayload(oauthConfig, parameters);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: form.toString(),
  });
  return parseDeviceAuthorizationResponse(response);
}

export async function pollDeviceAuthorizationToken(
  oauthConfig: RemoteMcpOAuthConfigRecord,
  deviceCode: string,
  parameters: RemoteMcpParameterInput[],
): Promise<DeviceAuthorizationPollResult> {
  const endpoint = appendQueryParameters(
    oauthConfig.tokenEndpoint,
    selectParameters(parameters, 'token_request_query'),
  );
  const body = buildTokenFormPayload(
    {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: oauthConfig.clientId,
    },
    parameters,
    [],
    [],
  );
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
    ...toHeaderMap(selectParameters(parameters, 'token_request_header')),
  };
  applyEndpointAuth(oauthConfig, headers, body);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: body.toString(),
  });
  if (response.ok) {
    return {
      kind: 'completed',
      token: await parseTokenResponse(response),
    };
  }
  const { payload, rawText } = await readOAuthResponseBody(response);
  const errorCode = typeof payload?.error === 'string' ? payload.error.trim() : '';
  if (errorCode === 'authorization_pending') {
    return {
      kind: 'pending',
      intervalSeconds: 5,
    };
  }
  if (errorCode === 'slow_down') {
    return {
      kind: 'pending',
      intervalSeconds: 10,
    };
  }
  const detail = typeof payload?.error_description === 'string'
    ? payload.error_description.trim()
    : rawText;
  throw new ValidationError(
    `Remote MCP device authorization token exchange failed with status ${response.status}${detail ? `: ${detail}` : ''}`,
  );
}

async function postTokenRequest(
  oauthConfig: RemoteMcpOAuthConfigRecord,
  baseValues: Record<string, string | undefined>,
  parameters: RemoteMcpParameterInput[] = [],
  resources: string[] = [],
  audiences: string[] = [],
): Promise<TokenResponse> {
  const endpoint = appendQueryParameters(
    oauthConfig.tokenEndpoint,
    selectParameters(parameters, 'token_request_query'),
  );
  const bodyKind = hasPlacement(parameters, 'token_request_body_json')
    ? 'json'
    : 'form';

  if (bodyKind === 'json') {
    const payload = buildTokenJsonPayload(baseValues, parameters, resources, audiences);
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
      ...toHeaderMap(selectParameters(parameters, 'token_request_header')),
    };
    applyEndpointAuth(oauthConfig, headers, payload);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    return parseTokenResponse(response);
  }

  const body = buildTokenFormPayload(baseValues, parameters, resources, audiences);
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
    ...toHeaderMap(selectParameters(parameters, 'token_request_header')),
  };
  applyEndpointAuth(oauthConfig, headers, body);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: body.toString(),
  });
  return parseTokenResponse(response);
}

function buildDeviceJsonPayload(
  oauthConfig: RemoteMcpOAuthConfigRecord,
  parameters: RemoteMcpParameterInput[],
): Record<string, string> {
  const payload: Record<string, string> = {
    client_id: oauthConfig.clientId,
  };
  if (oauthConfig.scopes.length > 0) {
    payload.scope = oauthConfig.scopes.join(' ');
  }
  for (const parameter of selectParameters(parameters, 'device_request_body_json')) {
    const value = parameter.value.trim();
    if (value) {
      payload[parameter.key] = value;
    }
  }
  return payload;
}

function buildDeviceFormPayload(
  oauthConfig: RemoteMcpOAuthConfigRecord,
  parameters: RemoteMcpParameterInput[],
): URLSearchParams {
  const form = new URLSearchParams({
    client_id: oauthConfig.clientId,
  });
  if (oauthConfig.scopes.length > 0) {
    form.set('scope', oauthConfig.scopes.join(' '));
  }
  applyFormParameters(form, selectParameters(parameters, 'device_request_body_form'));
  applyEndpointAuth(oauthConfig, {}, form);
  return form;
}

function buildTokenJsonPayload(
  baseValues: Record<string, string | undefined>,
  parameters: RemoteMcpParameterInput[],
  resources: string[],
  audiences: string[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(baseValues)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      payload[key] = value;
    }
  }
  if (resources.length > 0) {
    payload.resource = resources;
  }
  if (audiences.length > 0) {
    payload.audience = audiences;
  }
  for (const parameter of selectParameters(parameters, 'token_request_body_json')) {
    const value = parameter.value.trim();
    if (value) {
      payload[parameter.key] = value;
    }
  }
  return payload;
}

function buildTokenFormPayload(
  baseValues: Record<string, string | undefined>,
  parameters: RemoteMcpParameterInput[],
  resources: string[],
  audiences: string[],
): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(baseValues)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      body.set(key, value);
    }
  }
  for (const resource of resources) {
    if (resource.trim().length > 0) {
      body.append('resource', resource);
    }
  }
  for (const audience of audiences) {
    if (audience.trim().length > 0) {
      body.append('audience', audience);
    }
  }
  applyFormParameters(body, selectParameters(parameters, 'token_request_body_form'));
  return body;
}

function applyFormParameters(
  body: URLSearchParams,
  parameters: RemoteMcpParameterInput[],
): void {
  for (const parameter of parameters) {
    const value = parameter.value.trim();
    if (value) {
      body.append(parameter.key, value);
    }
  }
}

function appendQueryParameters(
  endpoint: string,
  parameters: RemoteMcpParameterInput[],
): string {
  if (parameters.length === 0) {
    return endpoint;
  }
  const url = new URL(endpoint);
  for (const parameter of parameters) {
    const value = parameter.value.trim();
    if (value) {
      url.searchParams.append(parameter.key, value);
    }
  }
  return url.toString();
}

function applyEndpointAuth(
  oauthConfig: RemoteMcpOAuthConfigRecord,
  headers: Record<string, string>,
  body: URLSearchParams | Record<string, unknown>,
): void {
  const clientSecret = oauthConfig.clientSecret ? decryptRemoteMcpSecret(oauthConfig.clientSecret) : null;
  if (oauthConfig.tokenEndpointAuthMethod === 'client_secret_post' && clientSecret) {
    if (body instanceof URLSearchParams) {
      body.set('client_secret', clientSecret);
    } else {
      body.client_secret = clientSecret;
    }
  }
  if (oauthConfig.tokenEndpointAuthMethod === 'client_secret_basic' && clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${oauthConfig.clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
  }
}

function selectParameters(
  parameters: RemoteMcpParameterInput[],
  placement: RemoteMcpParameterInput['placement'],
): RemoteMcpParameterInput[] {
  return parameters.filter((parameter) => parameter.placement === placement);
}

function hasPlacement(
  parameters: RemoteMcpParameterInput[],
  placement: RemoteMcpParameterInput['placement'],
): boolean {
  return parameters.some((parameter) => parameter.placement === placement);
}

function toHeaderMap(parameters: RemoteMcpParameterInput[]): Record<string, string> {
  return Object.fromEntries(
    parameters
      .map((parameter) => [parameter.key, parameter.value.trim()] as const)
      .filter(([, value]) => value.length > 0),
  );
}
