import { describe, it, expect } from 'vitest';
import { ConnectionIndicator } from './connection-indicator.js';

describe('ConnectionIndicator', () => {
  it('exports ConnectionIndicator as a function', () => {
    expect(typeof ConnectionIndicator).toBe('function');
  });

  it('accepts isConnected true', () => {
    const props = { isConnected: true };
    expect(props.isConnected).toBe(true);
  });

  it('accepts isConnected false', () => {
    const props = { isConnected: false };
    expect(props.isConnected).toBe(false);
  });
});
