import { describe, expect, it } from 'vitest';

import {
  formatOperatorStatusLabel,
  formatRelativeTimestampLabel,
  statusVariantForOperatorState,
  summarizeDisplayId,
} from './operator-display.js';

describe('operator display helpers', () => {
  it('formats status labels for operator-readable copy', () => {
    expect(formatOperatorStatusLabel('in_progress')).toBe('In Progress');
    expect(formatOperatorStatusLabel('outputPendingReview')).toBe('Output Pending Review');
    expect(formatOperatorStatusLabel('')).toBe('Unknown');
  });

  it('maps operator states to consistent badge variants', () => {
    expect(statusVariantForOperatorState('completed')).toBe('success');
    expect(statusVariantForOperatorState('awaiting_approval')).toBe('warning');
    expect(statusVariantForOperatorState('in_progress')).toBe('secondary');
    expect(statusVariantForOperatorState('custom_state')).toBe('outline');
  });

  it('truncates long identifiers for review surfaces', () => {
    expect(summarizeDisplayId('12345678-1234-1234-1234-abcdefabcdef')).toBe(
      '12345678...cdef',
    );
    expect(summarizeDisplayId('short-id')).toBe('short-id');
  });

  it('formats relative timestamps for compact operator review', () => {
    expect(
      formatRelativeTimestampLabel('2026-03-12T12:00:00Z', Date.parse('2026-03-12T12:00:30Z')),
    ).toBe('30s ago');
    expect(
      formatRelativeTimestampLabel('2026-03-12T12:00:00Z', Date.parse('2026-03-12T14:00:00Z')),
    ).toBe('2h ago');
  });
});
