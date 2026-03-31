import { describe, expect, it } from 'vitest';

import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  isWebhookSecretEncrypted,
} from '../../../../src/services/webhooks/webhook-secret-crypto.js';

describe('webhook secret encryption', () => {
  const encryptionKey = 'k'.repeat(64);

  it('encrypts and decrypts webhook secrets losslessly', () => {
    const plaintext = 'my-webhook-secret';
    const encrypted = encryptWebhookSecret(plaintext, encryptionKey);

    expect(isWebhookSecretEncrypted(encrypted)).toBe(true);
    expect(encrypted).not.toBe(plaintext);
    expect(decryptWebhookSecret(encrypted, encryptionKey)).toBe(plaintext);
  });

  it('passes through plaintext secrets for migration compatibility', () => {
    const plaintext = 'legacy-secret';

    expect(isWebhookSecretEncrypted(plaintext)).toBe(false);
    expect(decryptWebhookSecret(plaintext, encryptionKey)).toBe(plaintext);
  });
});
