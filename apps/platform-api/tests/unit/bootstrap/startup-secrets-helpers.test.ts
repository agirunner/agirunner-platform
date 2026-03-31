import { describe, expect, it } from 'vitest';

import { assertRequiredStartupSecrets } from '../../../src/bootstrap/startup-secrets.js';

describe('startup secret helpers', () => {
  it('rejects missing JWT_SECRET from the extracted helper module', () => {
    expect(() => assertRequiredStartupSecrets({})).toThrow(
      'Missing required environment variable JWT_SECRET. Set JWT_SECRET before starting platform-api.',
    );
  });
});
