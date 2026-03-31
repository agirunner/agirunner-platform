import { describe, expect, it } from 'vitest';

import { assertRequiredStartupSecrets } from '../../../src/bootstrap/app.js';

describe('startup secret checks', () => {
  it('fails with a clear error when JWT_SECRET is missing', () => {
    expect(() => assertRequiredStartupSecrets({})).toThrow(
      'Missing required environment variable JWT_SECRET. Set JWT_SECRET before starting platform-api.',
    );
  });

  it('fails with a clear error when WEBHOOK_ENCRYPTION_KEY is missing', () => {
    expect(() => assertRequiredStartupSecrets({ JWT_SECRET: 'x'.repeat(32) })).toThrow(
      'Missing required environment variable WEBHOOK_ENCRYPTION_KEY. Set WEBHOOK_ENCRYPTION_KEY before starting platform-api.',
    );
  });

  it('fails when JWT_SECRET is shorter than the minimum required length', () => {
    expect(() =>
      assertRequiredStartupSecrets({
        JWT_SECRET: 'short-secret',
        WEBHOOK_ENCRYPTION_KEY: 'x'.repeat(32),
      }),
    ).toThrow('JWT_SECRET must be at least 32 characters long.');
  });

  it('fails when WEBHOOK_ENCRYPTION_KEY is shorter than the minimum required length', () => {
    expect(() =>
      assertRequiredStartupSecrets({
        JWT_SECRET: 'x'.repeat(32),
        WEBHOOK_ENCRYPTION_KEY: 'short-key',
      }),
    ).toThrow('WEBHOOK_ENCRYPTION_KEY must be at least 32 characters long.');
  });

  it('allows startup checks to pass when both required secrets are set and long enough', () => {
    expect(() =>
      assertRequiredStartupSecrets({
        JWT_SECRET: 'x'.repeat(32),
        WEBHOOK_ENCRYPTION_KEY: 'y'.repeat(32),
      }),
    ).not.toThrow();
  });
});
