const DEFAULT_SECRET_REDACTION = 'redacted://secret';
const secretLikeKeyPattern = /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|known_hosts|webhook_url)/i;
const secretLikeValuePattern =
  /(?:^enc:v\d+:|^Bearer\s+\S+|^sk-[A-Za-z0-9_-]+|^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$)/i;

export interface SecretRedactionOptions {
  redactionValue?: string;
}

export function sanitizeSecretLikeValue(
  value: unknown,
  options: SecretRedactionOptions = {},
): unknown {
  return sanitizeValue(value, false, options.redactionValue ?? DEFAULT_SECRET_REDACTION);
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

function sanitizeValue(value: unknown, inheritedSecret: boolean, redactionValue: string): unknown {
  if (typeof value === 'string') {
    return shouldRedactString(value, inheritedSecret) ? redactionValue : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, inheritedSecret, redactionValue));
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
    );
  }
  return sanitized;
}

function shouldRedactString(value: string, inheritedSecret: boolean) {
  if (isAllowedSecretReference(value)) {
    return false;
  }
  if (inheritedSecret) {
    return value.trim().length > 0;
  }
  return secretLikeValuePattern.test(value.trim());
}

function isSecretLikeKey(key: string) {
  return secretLikeKeyPattern.test(key);
}

function isAllowedSecretReference(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('secret:') || normalized.startsWith('redacted://');
}
