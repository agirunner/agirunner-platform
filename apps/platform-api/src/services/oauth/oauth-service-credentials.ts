import {
  normalizeStoredProviderSecret,
  storeProviderSecret,
} from '../../lib/oauth-crypto.js';
import { ValidationError } from '../../errors/domain-errors.js';
import type {
  OAuthConfig,
  OAuthCredentials,
  OAuthSessionCredentialsInput,
  ResolvedOAuthToken,
} from './oauth-service-types.js';

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function buildImportedCredentials(
  input: OAuthSessionCredentialsInput,
  defaultUserId: string,
): OAuthCredentials {
  return {
    access_token: normalizeStoredProviderSecret(input.accessToken.trim()),
    refresh_token: normalizeNullableSecret(input.refreshToken),
    expires_at: normalizeImportedExpiry(input.expiresAt),
    account_id: normalizeNullableString(input.accountId),
    email: normalizeNullableString(input.email),
    authorized_at: input.authorizedAt ?? new Date().toISOString(),
    authorized_by_user_id: input.authorizedByUserId?.trim() || defaultUserId,
    needs_reauth: input.needsReauth ?? false,
  };
}

export function buildResolvedToken(
  accessTokenSecret: string,
  config: OAuthConfig,
  accountId: string | null,
): ResolvedOAuthToken {
  const extraHeaders: Record<string, string> = {};

  if (config.profile_id === 'openai-codex' && accountId) {
    extraHeaders['chatgpt-account-id'] = accountId;
    extraHeaders['OpenAI-Beta'] = 'responses=experimental';
  }

  return {
    accessTokenSecret,
    baseUrl: config.base_url,
    endpointType: config.endpoint_type,
    extraHeadersSecret:
      Object.keys(extraHeaders).length > 0
        ? storeProviderSecret(JSON.stringify(extraHeaders))
        : null,
  };
}

export function isCredentialAccessTokenUsable(
  creds: OAuthCredentials,
  config: OAuthConfig | null,
): boolean {
  return config?.token_lifetime === 'permanent' || !isTokenExpired(creds.expires_at);
}

export function normalizeOAuthCredentials(value: unknown): OAuthCredentials | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const accessToken = readString(record, 'access_token', 'accessToken');
  const authorizedAt = readString(record, 'authorized_at', 'authorizedAt');
  const authorizedByUserId = readString(record, 'authorized_by_user_id', 'authorizedByUserId');
  if (!accessToken || !authorizedAt || !authorizedByUserId) {
    return null;
  }

  return {
    access_token: normalizeStoredProviderSecret(accessToken),
    refresh_token: normalizeOptionalSecret(record, 'refresh_token', 'refreshToken'),
    expires_at: normalizeStoredExpiry(record, 'expires_at', 'expiresAt'),
    account_id: readNullableString(record, 'account_id', 'accountId'),
    email: readNullableString(record, 'email'),
    authorized_at: authorizedAt,
    authorized_by_user_id: authorizedByUserId,
    needs_reauth: readBoolean(record, 'needs_reauth', 'needsReauth'),
  };
}

function normalizeNullableSecret(value: string | null | undefined): string | null {
  if (!value || value.trim() === '') {
    return null;
  }
  return normalizeStoredProviderSecret(value.trim());
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (!value || value.trim() === '') {
    return null;
  }
  return value.trim();
}

function normalizeImportedExpiry(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return normalizeEpochTimestamp(value);
  }

  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && value.trim() !== '') {
    return normalizeEpochTimestamp(numericValue);
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new ValidationError('OAuth import expiresAt must be a unix timestamp or ISO date string');
  }
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return null;
}

function readNullableString(record: Record<string, unknown>, ...keys: string[]): string | null {
  return readString(record, ...keys);
}

function normalizeOptionalSecret(record: Record<string, unknown>, ...keys: string[]): string | null {
  const value = readString(record, ...keys);
  return value ? normalizeStoredProviderSecret(value) : null;
}

function normalizeStoredExpiry(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return normalizeEpochTimestamp(value);
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const numericValue = Number(value);
      if (Number.isFinite(numericValue)) {
        return normalizeEpochTimestamp(numericValue);
      }
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function readBoolean(record: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    if (record[key] === true) {
      return true;
    }
  }
  return false;
}

function normalizeEpochTimestamp(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (Math.abs(value) < 1_000_000_000_000) {
    return Math.trunc(value * 1000);
  }
  return Math.trunc(value);
}

function isTokenExpired(expiresAt: number | null): boolean {
  if (expiresAt === null) {
    return false;
  }
  return Date.now() >= expiresAt - EXPIRY_BUFFER_MS;
}
