import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import {
  isExternalSecretReference,
  ProviderSecretDecryptionError,
  readProviderSecret,
} from '../../lib/oauth-crypto.js';
import { ServiceUnavailableError, ValidationError } from '../../errors/domain-errors.js';
import {
  CLAIM_CREDENTIAL_HANDLE_ENCRYPTION_ALGORITHM,
  CLAIM_CREDENTIAL_HANDLE_IV_LENGTH_BYTES,
  CLAIM_CREDENTIAL_HANDLE_VERSION,
} from './task-claim-constants.js';
import type {
  ClaimCredentialKind,
  ClaimCredentialPayload,
} from './task-claim-types.js';

export function buildClaimCredentialResolutionError(): ServiceUnavailableError {
  return new ServiceUnavailableError(
    'Stored OAuth credentials are unavailable. Verify platform secret configuration before retrying.',
    {
      category: 'provider_credentials_unavailable',
      retryable: false,
      recoverable: false,
    },
  );
}

export function mapClaimCredentialResolutionError(error: unknown): Error {
  if (error instanceof ProviderSecretDecryptionError) {
    return buildClaimCredentialResolutionError();
  }
  return error instanceof Error ? error : buildClaimCredentialResolutionError();
}

export function toClaimStringCredential(
  taskId: string,
  kind: ClaimCredentialKind,
  handleKey: string,
  secretRefKey: string,
  stored: string | null | undefined,
  claimHandleSecret: string,
  options?: { providerId?: string },
): Record<string, unknown> {
  const normalized = typeof stored === 'string' ? stored.trim() : '';
  if (!normalized) {
    return {};
  }
  if (isExternalSecretReference(normalized)) {
    return { [secretRefKey]: normalized };
  }
  return {
    [handleKey]: createClaimCredentialHandle(
      taskId,
      kind,
      normalized,
      claimHandleSecret,
      options,
    ),
  };
}

export function toClaimObjectCredential(
  taskId: string,
  kind: ClaimCredentialKind,
  handleKey: string,
  secretRefKey: string,
  stored: string | null | undefined,
  claimHandleSecret: string,
  options?: { providerId?: string },
): Record<string, unknown> {
  const normalized = typeof stored === 'string' ? stored.trim() : '';
  if (!normalized) {
    return {};
  }
  if (isExternalSecretReference(normalized)) {
    return { [secretRefKey]: normalized };
  }
  return {
    [handleKey]: createClaimCredentialHandle(
      taskId,
      kind,
      normalized,
      claimHandleSecret,
      options,
    ),
  };
}

export function parseExtraHeadersSecret(secret: string): Record<string, string> {
  const parsed = JSON.parse(readProviderSecret(secret)) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value] as const] : [],
    ),
  );
}

export function createClaimCredentialHandle(
  taskId: string,
  kind: ClaimCredentialKind,
  storedSecret: string,
  claimHandleSecret: string,
  options?: { providerId?: string },
): string {
  const iv = randomBytes(CLAIM_CREDENTIAL_HANDLE_IV_LENGTH_BYTES);
  const cipher = createCipheriv(
    CLAIM_CREDENTIAL_HANDLE_ENCRYPTION_ALGORITHM,
    deriveClaimHandleKey(claimHandleSecret),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(
      JSON.stringify({
        task_id: taskId,
        kind,
        stored_secret: storedSecret,
        provider_id: options?.providerId ?? undefined,
      }),
      'utf8',
    ),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `claim:${CLAIM_CREDENTIAL_HANDLE_VERSION}:${iv.toString('base64url')}.${encrypted.toString('base64url')}.${authTag.toString('base64url')}`;
}

export function parseClaimCredentialHandle(
  handle: string,
  expectedTaskId: string,
  expectedKind: ClaimCredentialKind,
  claimHandleSecret: string,
): string {
  return parseClaimCredentialHandlePayload(
    handle,
    expectedTaskId,
    expectedKind,
    claimHandleSecret,
  ).stored_secret;
}

export function parseClaimCredentialHandlePayload(
  handle: string,
  expectedTaskId: string,
  expectedKind: ClaimCredentialKind,
  claimHandleSecret: string,
): ClaimCredentialPayload & { stored_secret: string } {
  const prefix = `claim:${CLAIM_CREDENTIAL_HANDLE_VERSION}:`;
  if (!handle.startsWith(prefix)) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  const encoded = handle.slice(prefix.length);
  const decoded = readClaimCredentialPayload(encoded, claimHandleSecret);
  if (
    decoded.task_id !== expectedTaskId
    || decoded.kind !== expectedKind
    || typeof decoded.stored_secret !== 'string'
  ) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  return decoded as ClaimCredentialPayload & { stored_secret: string };
}

export function parseMcpClaimCredentialHandle(
  handle: string,
  expectedTaskId: string,
  claimHandleSecret: string,
): string {
  try {
    return parseClaimCredentialHandle(handle, expectedTaskId, 'mcp_parameter', claimHandleSecret);
  } catch {
    return parseClaimCredentialHandle(handle, expectedTaskId, 'mcp_oauth', claimHandleSecret);
  }
}

function deriveClaimHandleKey(claimHandleSecret: string): Buffer {
  return createHash('sha256').update(claimHandleSecret, 'utf8').digest();
}

function readClaimCredentialPayload(
  encoded: string,
  claimHandleSecret: string,
): ClaimCredentialPayload {
  const segments = encoded.split('.');
  if (segments.length === 2) {
    return readLegacyClaimCredentialPayload(encoded, claimHandleSecret);
  }
  if (segments.length === 3) {
    return readOpaqueClaimCredentialPayload(segments, claimHandleSecret);
  }
  throw new ValidationError('Invalid claim credential handle.');
}

function readLegacyClaimCredentialPayload(
  encoded: string,
  claimHandleSecret: string,
): ClaimCredentialPayload {
  const separator = encoded.lastIndexOf('.');
  if (separator <= 0 || separator === encoded.length - 1) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  const payload = encoded.slice(0, separator);
  const signature = encoded.slice(separator + 1);
  const expectedSignature = createHmac('sha256', claimHandleSecret).update(payload).digest();
  const providedSignature = Buffer.from(signature, 'base64url');
  if (
    expectedSignature.length !== providedSignature.length
    || !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  return parseClaimCredentialPayload(Buffer.from(payload, 'base64url').toString('utf8'));
}

function readOpaqueClaimCredentialPayload(
  segments: string[],
  claimHandleSecret: string,
): ClaimCredentialPayload {
  const [ivBase64, encryptedBase64, authTagBase64] = segments;
  if (!ivBase64 || !encryptedBase64 || !authTagBase64) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  try {
    const decipher = createDecipheriv(
      CLAIM_CREDENTIAL_HANDLE_ENCRYPTION_ALGORITHM,
      deriveClaimHandleKey(claimHandleSecret),
      Buffer.from(ivBase64, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTagBase64, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, 'base64url')),
      decipher.final(),
    ]);
    return parseClaimCredentialPayload(decrypted.toString('utf8'));
  } catch {
    throw new ValidationError('Invalid claim credential handle.');
  }
}

function parseClaimCredentialPayload(payload: string): ClaimCredentialPayload {
  try {
    return JSON.parse(payload) as ClaimCredentialPayload;
  } catch {
    throw new ValidationError('Invalid claim credential handle.');
  }
}
