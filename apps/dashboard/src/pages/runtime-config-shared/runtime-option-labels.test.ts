import { describe, expect, it } from 'vitest';

import { formatRuntimeOptionLabel } from './runtime-option-labels.js';

describe('runtime option labels', () => {
  it('formats orchestrator continuity values for operators', () => {
    expect(formatRuntimeOptionLabel('activation_checkpoint')).toBe('Activation checkpoint');
    expect(formatRuntimeOptionLabel('emergency_only')).toBe('Emergency only');
    expect(formatRuntimeOptionLabel('tpaov')).toBe('TPAOV');
  });

  it('formats generic option values without changing their stored meaning', () => {
    expect(formatRuntimeOptionLabel('if-not-present')).toBe('If not present');
    expect(formatRuntimeOptionLabel('provider_native')).toBe('Provider native');
  });
});
