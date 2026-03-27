import { ValidationError } from '../errors/domain-errors.js';
import type {
  DeviceAuthorizationResponse,
  TokenResponse,
} from './remote-mcp-oauth-types.js';

interface ParsedOAuthBody {
  payload: Record<string, unknown> | null;
  rawText: string;
}

export async function parseTokenResponse(response: Response): Promise<TokenResponse> {
  const parsed = await readOAuthResponseBody(response);
  const detail = describeOauthError(parsed.payload);
  if (!response.ok) {
    throw new ValidationError(
      `Remote MCP OAuth token exchange failed with status ${response.status}${detail ? `: ${detail}` : parsed.rawText ? `: ${parsed.rawText}` : ''}`,
    );
  }
  if (detail) {
    throw new ValidationError(`Remote MCP OAuth token exchange failed: ${detail}`);
  }
  const accessToken = readRequiredString(parsed.payload, 'access_token');
  const token: TokenResponse = {
    access_token: accessToken,
  };
  const refreshToken = readOptionalString(parsed.payload, 'refresh_token');
  const tokenType = readOptionalString(parsed.payload, 'token_type');
  const scope = readOptionalString(parsed.payload, 'scope');
  const expiresIn = readOptionalInteger(parsed.payload, 'expires_in');
  if (refreshToken) {
    token.refresh_token = refreshToken;
  }
  if (tokenType) {
    token.token_type = tokenType;
  }
  if (scope) {
    token.scope = scope;
  }
  if (expiresIn !== null) {
    token.expires_in = expiresIn;
  }
  return token;
}

export async function parseDeviceAuthorizationResponse(
  response: Response,
): Promise<DeviceAuthorizationResponse> {
  const parsed = await readOAuthResponseBody(response);
  const detail = describeOauthError(parsed.payload);
  if (!response.ok) {
    throw new ValidationError(
      `Remote MCP device authorization failed with status ${response.status}${detail ? `: ${detail}` : parsed.rawText ? `: ${parsed.rawText}` : ''}`,
    );
  }
  if (detail) {
    throw new ValidationError(`Remote MCP device authorization failed: ${detail}`);
  }
  return {
    device_code: readRequiredString(parsed.payload, 'device_code'),
    user_code: readRequiredString(parsed.payload, 'user_code'),
    verification_uri: readRequiredString(parsed.payload, 'verification_uri'),
    expires_in: readRequiredInteger(parsed.payload, 'expires_in'),
    verification_uri_complete: readOptionalString(parsed.payload, 'verification_uri_complete') ?? undefined,
    interval: readOptionalInteger(parsed.payload, 'interval') ?? undefined,
  };
}

export async function readOAuthResponseBody(response: Response): Promise<ParsedOAuthBody> {
  const rawText = await response.text().catch(() => '');
  const normalized = rawText.trim();
  if (!normalized) {
    return {
      payload: null,
      rawText: '',
    };
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    return {
      payload: parseJsonRecord(normalized),
      rawText: normalized,
    };
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return {
      payload: parseFormRecord(normalized),
      rawText: normalized,
    };
  }
  return {
    payload: parseJsonRecord(normalized) ?? parseFormRecord(normalized),
    rawText: normalized,
  };
}

function parseJsonRecord(rawText: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseFormRecord(rawText: string): Record<string, unknown> | null {
  try {
    const params = new URLSearchParams(rawText);
    const record = Object.fromEntries(params.entries());
    return Object.keys(record).length > 0 ? record : null;
  } catch {
    return null;
  }
}

function describeOauthError(payload: Record<string, unknown> | null): string | null {
  const error = readOptionalString(payload, 'error');
  if (!error) {
    return null;
  }
  const description = readOptionalString(payload, 'error_description');
  return description ? `${error}: ${description}` : error;
}

function readRequiredString(payload: Record<string, unknown> | null, key: string): string {
  const value = readOptionalString(payload, key);
  if (!value) {
    throw new ValidationError(`Remote MCP OAuth response did not include a usable ${key}`);
  }
  return value;
}

function readRequiredInteger(payload: Record<string, unknown> | null, key: string): number {
  const value = readOptionalInteger(payload, key);
  if (value === null) {
    throw new ValidationError(`Remote MCP OAuth response did not include a usable ${key}`);
  }
  return value;
}

function readOptionalString(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readOptionalInteger(payload: Record<string, unknown> | null, key: string): number | null {
  const value = payload?.[key];
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
