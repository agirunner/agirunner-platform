import { describe, expect, it } from 'vitest';

import { enforceScope, hasRequiredScope } from '../../../../src/auth/scope.js';

describe('scope authorization', () => {
  it('treats service keys as admin-equivalent for current protected endpoints', () => {
    expect(hasRequiredScope('service' as never, 'admin')).toBe(true);
    expect(() => enforceScope('service' as never, 'admin')).not.toThrow();
  });

  it('does not allow system keys to satisfy admin endpoints', () => {
    expect(hasRequiredScope('worker', 'admin')).toBe(false);
    expect(hasRequiredScope('agent', 'admin')).toBe(false);
  });
});
