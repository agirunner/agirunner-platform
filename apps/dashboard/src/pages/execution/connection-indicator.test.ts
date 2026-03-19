import { describe, it, expect } from 'vitest';
import { ConnectionIndicator } from './connection-indicator';

describe('ConnectionIndicator', () => {
  it('exports ConnectionIndicator as a function', () => {
    expect(typeof ConnectionIndicator).toBe('function');
  });
});
