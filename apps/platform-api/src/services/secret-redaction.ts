import {
  PLATFORM_LOGGING_SECRET_REDACTION_ID,
  mustGetSafetynetEntry,
} from './safetynet/registry.js';
import { logSafetynetTriggered } from './safetynet/logging.js';

const DEFAULT_SECRET_REDACTION = 'redacted://secret';
export const SECRET_REDACTION_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_LOGGING_SECRET_REDACTION_ID,
);
const secretLikeKeyPattern = /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|known_hosts|webhook_url)/i;
const explicitSecretReferencePattern = /secret:[A-Za-z0-9_:-]+/i;
const exactSecretLikeValuePattern = /^(?:enc:v\d+:.*|Bearer\s+\S+|sk-[A-Za-z0-9_-]+)$/i;
const embeddedSecretLikeValuePattern = /(?:\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]+\b)/i;
const dottedTokenPattern = /\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

export interface SecretRedactionOptions {
  redactionValue?: string;
  allowSecretReferences?: boolean;
}

export function sanitizeSecretLikeValue(
  value: unknown,
  options: SecretRedactionOptions = {},
): unknown {
  const sanitized = sanitizeValue(
    value,
    false,
    options.redactionValue ?? DEFAULT_SECRET_REDACTION,
    options.allowSecretReferences ?? true,
  );
  if (containsRedactionMarker(sanitized) && !containsRedactionMarker(value)) {
    logSafetynetTriggered(SECRET_REDACTION_SAFETYNET, 'platform secret redaction applied');
  }
  return sanitized;
}

export function sanitizeSecretLikeRecord(
  value: unknown,
  options: SecretRedactionOptions = {},
): Record<string, unknown> {
  const sanitized = sanitizeSecretLikeValue(value, options);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : {};
}

function sanitizeValue(
  value: unknown,
  inheritedSecret: boolean,
  redactionValue: string,
  allowSecretReferences: boolean,
): unknown {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string') {
    return shouldRedactString(value, inheritedSecret, allowSecretReferences) ? redactionValue : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, inheritedSecret, redactionValue, allowSecretReferences));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = sanitizeValue(
      nestedValue,
      inheritedSecret || isSecretLikeKey(key),
      redactionValue,
      allowSecretReferences,
    );
  }
  return sanitized;
}

function shouldRedactString(value: string, inheritedSecret: boolean, allowSecretReferences: boolean) {
  if (allowSecretReferences && isAllowedSecretReference(value)) {
    return false;
  }
  const trimmed = value.trim();
  if (inheritedSecret) {
    return trimmed.length > 0;
  }
  if (!allowSecretReferences && explicitSecretReferencePattern.test(trimmed)) {
    return true;
  }
  return exactSecretLikeValuePattern.test(trimmed) ||
    embeddedSecretLikeValuePattern.test(trimmed) ||
    containsJWTLikeToken(trimmed);
}

export function isSecretLikeKey(key: string) {
  return secretLikeKeyPattern.test(key);
}

function isAllowedSecretReference(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('secret:') || normalized.startsWith('redacted://');
}

function containsJWTLikeToken(value: string) {
  const exactMatch = value.match(dottedTokenPattern);
  if (!exactMatch) {
    return false;
  }
  return exactMatch.some((candidate) => looksLikeJWTLikeToken(candidate));
}

function looksLikeJWTLikeToken(value: string) {
  const parts = value.split('.');
  if (parts.length !== 3) {
    return false;
  }
  if (parts.some((part) => part.length < 6)) {
    return false;
  }
  return parts.some((part) => /[A-Z0-9]/.test(part));
}

function containsRedactionMarker(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('redacted://');
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsRedactionMarker(item));
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Object.values(value).some((entry) => containsRedactionMarker(entry));
}
