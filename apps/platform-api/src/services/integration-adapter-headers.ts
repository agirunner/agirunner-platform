import { decryptWebhookSecret, encryptWebhookSecret } from './webhook-secret-crypto.js';

const SECRET_HEADER_REDACTION = 'redacted://integration-header-secret';

export function normalizeIntegrationHeaders(
  headers: unknown,
  encryptionKey: string,
): Record<string, string> {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string')
      .map(([key, value]) => {
        const normalizedValue = value as string;
        return [
          key,
          isSecretLikeHeader(key, normalizedValue)
            ? encryptWebhookSecret(normalizedValue, encryptionKey)
            : normalizedValue,
        ];
      }),
  ) as Record<string, string>;
}

export function sanitizeIntegrationHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      isSecretLikeHeader(key, value) ? SECRET_HEADER_REDACTION : value,
    ]),
  );
}

export function decryptIntegrationHeaders(
  headers: Record<string, string>,
  encryptionKey: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      isSecretLikeHeader(key, value) ? decryptWebhookSecret(value, encryptionKey) : value,
    ]),
  );
}

export function migrateStoredIntegrationHeaders(
  headers: Record<string, string>,
  encryptionKey: string,
): { headers: Record<string, string>; changed: boolean } {
  let changed = false;
  const migrated = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      if (!shouldEncryptHeaderValue(key, value)) {
        return [key, value];
      }
      changed = true;
      return [key, encryptWebhookSecret(value, encryptionKey)];
    }),
  ) as Record<string, string>;

  return { headers: migrated, changed };
}

function isSecretLikeHeader(key: string, value: string): boolean {
  const normalizedKey = key.trim().toLowerCase();
  const normalizedValue = value.trim();
  return (
    /(authorization|api[-_]?key|token|secret|credential)/i.test(normalizedKey) ||
    /^bearer\s+\S+/i.test(normalizedValue) ||
    /^secret:/i.test(normalizedValue) ||
    /^redacted:\/\//i.test(normalizedValue) ||
    /^enc:v\d+:/i.test(normalizedValue)
  );
}

function shouldEncryptHeaderValue(key: string, value: string): boolean {
  const normalizedValue = value.trim();
  if (!isSecretLikeHeader(key, value)) {
    return false;
  }
  return !/^enc:v\d+:/i.test(normalizedValue) && !/^secret:/i.test(normalizedValue);
}
