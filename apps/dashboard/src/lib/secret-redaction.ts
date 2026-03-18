const DEFAULT_SECRET_REDACTION = 'redacted://secret';
const secretLikeKeyPattern =
  /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|known_hosts|webhook_url)/i;
const secretLikeValuePattern =
  /(?:enc:v\d+:|Bearer\s+\S+|sk-[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i;

export function sanitizeSecretLikeValue(value: unknown): unknown {
  return sanitizeValue(value, false);
}

function sanitizeValue(value: unknown, inheritedSecret: boolean): unknown {
  if (typeof value === 'string') {
    return shouldRedactString(value, inheritedSecret) ? DEFAULT_SECRET_REDACTION : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, inheritedSecret));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = sanitizeValue(nestedValue, inheritedSecret || secretLikeKeyPattern.test(key));
  }
  return sanitized;
}

function shouldRedactString(value: string, inheritedSecret: boolean) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (inheritedSecret) {
    return true;
  }
  return secretLikeValuePattern.test(trimmed);
}
