import { describe, it, expect } from 'vitest';
import { WorkflowStatusRow, getStatusColor } from './workflow-status-row.js';

describe('WorkflowStatusRow', () => {
  it('exports WorkflowStatusRow', () => expect(typeof WorkflowStatusRow).toBe('function'));
});

describe('getStatusColor', () => {
  it('returns success for active state', () => {
    expect(getStatusColor({ state: 'active' })).toBe('var(--color-status-success)');
  });

  it('returns warning for gate waiting', () => {
    expect(getStatusColor({ state: 'active', gateWaiting: true })).toBe('var(--color-status-warning)');
  });

  it('returns warning for needs attention', () => {
    expect(getStatusColor({ state: 'active', needsAttention: true })).toBe('var(--color-status-warning)');
  });

  it('returns error for failed', () => {
    expect(getStatusColor({ state: 'failed' })).toBe('var(--color-status-error)');
  });

  it('returns error for cancelled', () => {
    expect(getStatusColor({ state: 'cancelled' })).toBe('var(--color-status-error)');
  });

  it('returns success for completed state', () => {
    expect(getStatusColor({ state: 'completed' })).toBe('var(--color-status-success)');
  });

  it('gate waiting takes precedence over active state', () => {
    const color = getStatusColor({ state: 'active', gateWaiting: true });
    expect(color).toBe('var(--color-status-warning)');
  });

  it('error states take precedence over flags', () => {
    const color = getStatusColor({ state: 'failed', gateWaiting: true });
    expect(color).toBe('var(--color-status-error)');
  });
});
