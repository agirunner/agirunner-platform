import { describe, it, expect } from 'vitest';
import { DepthDial, DEPTH_LABELS } from './depth-dial.js';

describe('DepthDial', () => {
  it('exports DepthDial', () => expect(typeof DepthDial).toBe('function'));
  it('exports DEPTH_LABELS with 3 levels', () => {
    expect(DEPTH_LABELS[1]).toBe('Tasks');
    expect(DEPTH_LABELS[2]).toBe('Agent Turns');
    expect(DEPTH_LABELS[3]).toBe('Raw Stream');
  });
});
