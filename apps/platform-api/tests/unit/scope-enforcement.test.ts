import { describe, expect, it } from 'vitest';

import { enforceScope, hasRequiredScope } from '../../src/auth/scope.js';

describe('scope enforcement', () => {
  it('allows admin scope to satisfy worker requirements', () => {
    expect(hasRequiredScope('admin', 'worker')).toBe(true);
  });

  it('allows worker scope to satisfy agent requirements', () => {
    expect(hasRequiredScope('worker', 'agent')).toBe(true);
  });

  it('rejects agent scope for admin requirements', () => {
    expect(hasRequiredScope('agent', 'admin')).toBe(false);
  });

  it('throws when required scope is higher than caller scope', () => {
    expect(() => enforceScope('agent', 'admin')).toThrowError();
  });
});
