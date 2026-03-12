import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PROVIDER_SECRET_MARKER = 'enc';
const PROVIDER_SECRET_VERSION = 'v1';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const GCM_IV_LENGTH_BYTES = 12;
const EXTERNAL_SECRET_REFERENCE_PREFIXES = ['secret:', 'redacted://'];

export function storeOAuthToken(plaintext: string): string {
  return encryptProviderSecret(plaintext);
}

export function readOAuthToken(stored: string): string {
  return decryptProviderSecret(stored);
}

export function storeProviderSecret(plaintext: string): string {
  return encryptProviderSecret(plaintext);
}

export function readProviderSecret(stored: string): string {
  return decryptProviderSecret(stored);
}

export function isProviderSecretEncrypted(secret: string): boolean {
  return secret.startsWith(`${PROVIDER_SECRET_MARKER}:${PROVIDER_SECRET_VERSION}:`);
}

export function isExternalSecretReference(secret: string): boolean {
  const normalized = secret.trim().toLowerCase();
  return EXTERNAL_SECRET_REFERENCE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function normalizeStoredProviderSecret(secret: string): string {
  if (secret === '' || isProviderSecretEncrypted(secret) || isExternalSecretReference(secret)) {
    return secret;
  }
  return encryptProviderSecret(secret);
}

function encryptProviderSecret(secret: string): string {
  if (secret === '') {
    return secret;
  }

  const iv = randomBytes(GCM_IV_LENGTH_BYTES);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    PROVIDER_SECRET_MARKER,
    PROVIDER_SECRET_VERSION,
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    authTag.toString('base64url'),
  ].join(':');
}

function decryptProviderSecret(secret: string): string {
  if (!isProviderSecretEncrypted(secret)) {
    return secret;
  }

  const [marker, version, ivBase64, encryptedBase64, authTagBase64, ...rest] = secret.split(':');
  if (
    marker !== PROVIDER_SECRET_MARKER ||
    version !== PROVIDER_SECRET_VERSION ||
    !ivBase64 ||
    !encryptedBase64 ||
    !authTagBase64 ||
    rest.length > 0
  ) {
    throw new Error('Invalid encrypted provider secret format');
  }

  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    deriveKey(),
    Buffer.from(ivBase64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(authTagBase64, 'base64url'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function deriveKey(): Buffer {
  const rawKey = process.env.WEBHOOK_ENCRYPTION_KEY?.trim();
  if (!rawKey) {
    throw new Error('WEBHOOK_ENCRYPTION_KEY is required for provider secret encryption');
  }
  return createHash('sha256').update(rawKey, 'utf8').digest();
}
