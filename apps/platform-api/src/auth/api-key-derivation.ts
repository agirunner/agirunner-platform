import { createHash } from 'node:crypto';

const CANONICAL_API_KEY_PATTERN = /^ar_(admin|agent|worker|service)_[A-Za-z0-9_-]{16,}$/;
const LEGACY_API_KEY_PATTERN = /^(?:ar|ab)_[A-Za-z0-9_-]{6,}_(admin|agent|worker|service)_[A-Za-z0-9_-]{16,}$/;

export function isSupportedApiKeyFormat(apiKeyRaw: string): boolean {
  return CANONICAL_API_KEY_PATTERN.test(apiKeyRaw) || LEGACY_API_KEY_PATTERN.test(apiKeyRaw);
}

export function deriveCanonicalKeyPrefix(apiKeyRaw: string): string {
  const digest = createHash('sha256').update(apiKeyRaw).digest('base64url');
  return `k${digest.slice(0, 11)}`;
}

export function deriveApiKeyLookupPrefixes(apiKeyRaw: string): string[] {
  const legacyPrefix = apiKeyRaw.slice(0, 12);

  if (CANONICAL_API_KEY_PATTERN.test(apiKeyRaw)) {
    return [deriveCanonicalKeyPrefix(apiKeyRaw), legacyPrefix];
  }

  return [legacyPrefix];
}

export function deriveApiKeyLookupHash(apiKeyRaw: string): string {
  return createHash('sha256').update(apiKeyRaw).digest('hex');
}
