import { ValidationError } from '../../../errors/domain-errors.js';
import {
  isExternalSecretReference,
  isProviderSecretEncrypted,
  readProviderSecret,
  storeProviderSecret,
} from '../../../lib/oauth-crypto.js';

export const REMOTE_MCP_STORED_SECRET_VALUE = 'redacted://remote-mcp-secret';

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
  const normalized = secret.trim();
  if (normalized === '' || normalized === REMOTE_MCP_STORED_SECRET_VALUE || isProviderSecretEncrypted(normalized)) {
    return normalized;
  }
  if (isExternalSecretReference(normalized)) {
    throw new ValidationError(
      'Remote MCP secrets must be stored directly in the platform database. External secret references are not supported.',
    );
  }
  return storeProviderSecret(normalized);
}
