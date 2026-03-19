import { describe, expect, it } from 'vitest';

import { generateDefaultBranch } from './launch-parameters-form.js';

describe('generateDefaultBranch', () => {
  it('converts name to branch format', () => {
    expect(generateDefaultBranch('Fix Mobile Login')).toBe('fix/mobile-login');
  });

  it('handles empty string', () => {
    expect(generateDefaultBranch('')).toBe('');
  });

  it('handles single word', () => {
    expect(generateDefaultBranch('Refactor')).toBe('refactor/');
  });

  it('handles lowercase input', () => {
    expect(generateDefaultBranch('add feature flag')).toBe('add/feature-flag');
  });
});

import { LaunchParametersForm } from './launch-parameters-form.js';

describe('LaunchParametersForm', () => {
  it('exports LaunchParametersForm', () => expect(typeof LaunchParametersForm).toBe('function'));
});
