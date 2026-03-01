import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const WEBHOOK_SECRET_ENCRYPTION_MARKER = 'enc';
const WEBHOOK_SECRET_ENCRYPTION_VERSION = 'v1';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const GCM_IV_LENGTH_BYTES = 12;

function deriveKey(encryptionKey: string): Buffer {
  return createHash('sha256').update(encryptionKey, 'utf8').digest();
}

export function isWebhookSecretEncrypted(secret: string): boolean {
  return secret.startsWith(`${WEBHOOK_SECRET_ENCRYPTION_MARKER}:${WEBHOOK_SECRET_ENCRYPTION_VERSION}:`);
}

export function encryptWebhookSecret(secret: string, encryptionKey: string): string {
  const iv = randomBytes(GCM_IV_LENGTH_BYTES);
  const key = deriveKey(encryptionKey);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    WEBHOOK_SECRET_ENCRYPTION_MARKER,
    WEBHOOK_SECRET_ENCRYPTION_VERSION,
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    authTag.toString('base64url'),
  ].join(':');
}

export function decryptWebhookSecret(secret: string, encryptionKey: string): string {
  if (!isWebhookSecretEncrypted(secret)) {
    return secret;
  }

  const [marker, version, ivBase64, encryptedBase64, authTagBase64, ...rest] = secret.split(':');
  if (
    marker !== WEBHOOK_SECRET_ENCRYPTION_MARKER ||
    version !== WEBHOOK_SECRET_ENCRYPTION_VERSION ||
    !ivBase64 ||
    !encryptedBase64 ||
    !authTagBase64 ||
    rest.length > 0
  ) {
    throw new Error('Invalid encrypted webhook secret format');
  }

  const key = deriveKey(encryptionKey);
  const iv = Buffer.from(ivBase64, 'base64url');
  const encrypted = Buffer.from(encryptedBase64, 'base64url');
  const authTag = Buffer.from(authTagBase64, 'base64url');

  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
