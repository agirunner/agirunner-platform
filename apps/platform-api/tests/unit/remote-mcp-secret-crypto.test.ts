import { beforeEach, describe, expect, it } from 'vitest';

import { configureProviderSecretEncryptionKey } from '../../src/lib/oauth-crypto.js';
import {
  decryptRemoteMcpSecret,
  encryptRemoteMcpSecret,
  isRemoteMcpSecretEncrypted,
  normalizeStoredRemoteMcpSecret,
} from '../../src/services/remote-mcp-secret-crypto.js';

describe('remote-mcp-secret-crypto', () => {
  beforeEach(() => {
    configureProviderSecretEncryptionKey('test-webhook-encryption-key-abcdefghijklmnopqrstuvwxyz');
  });

  it('encrypts and decrypts remote MCP secret values', () => {
    const encrypted = encryptRemoteMcpSecret('super-secret');

    expect(isRemoteMcpSecretEncrypted(encrypted)).toBe(true);
    expect(decryptRemoteMcpSecret(encrypted)).toBe('super-secret');
  });

  it('keeps external secret references unmodified', () => {
    expect(normalizeStoredRemoteMcpSecret('secret:provider/mcp/token')).toBe(
      'secret:provider/mcp/token',
    );
  });
});
