import { describe, expect, it } from 'vitest';

import { enforceScope, hasRequiredScope } from '../../src/auth/scope.js';

describe('scope enforcement', () => {
  it('checks hierarchy correctly', () => {
    expect(hasRequiredScope('admin', 'worker')).toBe(true);
    expect(hasRequiredScope('worker', 'agent')).toBe(true);
    expect(hasRequiredScope('agent', 'admin')).toBe(false);
  });

  it('throws for insufficient scope', () => {
    expect(() => enforceScope('agent', 'admin')).toThrowError();
  });
});
