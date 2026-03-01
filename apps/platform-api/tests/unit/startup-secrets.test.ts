import { describe, expect, it } from 'vitest';

import { assertRequiredStartupSecrets } from '../../src/bootstrap/app.js';

describe('startup secret checks', () => {
  it('fails with a clear error when JWT_SECRET is missing', () => {
    expect(() => assertRequiredStartupSecrets({})).toThrow(
      'Missing required environment variable JWT_SECRET. Set JWT_SECRET before starting platform-api.',
    );
  });

  it('allows startup checks to pass when JWT_SECRET is set', () => {
    expect(() => assertRequiredStartupSecrets({ JWT_SECRET: 'x'.repeat(32) })).not.toThrow();
  });
});
