import {
  isExternalSecretReference,
  isProviderSecretEncrypted,
  readProviderSecret,
  storeProviderSecret,
} from '../lib/oauth-crypto.js';

export function encryptRemoteMcpSecret(secret: string): string {
  return storeProviderSecret(secret);
}

export function decryptRemoteMcpSecret(secret: string): string {
  return readProviderSecret(secret);
}

export function isRemoteMcpSecretEncrypted(secret: string): boolean {
  return isProviderSecretEncrypted(secret);
}

export function normalizeStoredRemoteMcpSecret(secret: string): string {
  if (secret === '' || isExternalSecretReference(secret) || isProviderSecretEncrypted(secret)) {
    return secret;
  }
  return storeProviderSecret(secret);
}
