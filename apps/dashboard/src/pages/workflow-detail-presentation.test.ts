import { describe, expect, it } from 'vitest';

import {
  describeReviewPacket,
  formatAbsoluteTimestamp,
  formatFileSize,
  formatRelativeTimestamp,
  mergeSelectableOptions,
  summarizeIdentifier,
  toStructuredDetailViewData,
} from './workflow-detail-presentation.js';

describe('workflow detail presentation helpers', () => {
  it('describes structured review packets with top-level badges', () => {
    expect(
      describeReviewPacket({
        stage_name: 'implementation',
        owner_role: 'engineer',
        notes: { priority: 'high' },
      }, 'event packet'),
    ).toEqual({
      typeLabel: 'Structured',
      summary: '3 fields captured',
      detail: '1 nested section available in this event packet.',
      badges: ['Stage Name', 'Owner Role', 'Notes'],
      hasStructuredDetail: true,
    });
  });

  it('wraps arrays and primitives so structured detail views stay usable', () => {
    expect(toStructuredDetailViewData(['a', 'b'])).toEqual({ items: ['a', 'b'] });
    expect(toStructuredDetailViewData('hello')).toEqual({ value: 'hello' });
  });

  it('formats relative and absolute timestamps for glanceable operator history', () => {
    const timestamp = '2026-03-12T11:45:00.000Z';
    expect(
      formatRelativeTimestamp(timestamp, new Date('2026-03-12T12:00:00.000Z').getTime()),
    ).toBe('15m ago');
    expect(formatAbsoluteTimestamp(timestamp)).toContain('2026');
  });

  it('formats artifact sizes and preserves current selector values inside bounded choices', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(mergeSelectableOptions(['reviewer', 'engineer'], 'orchestrator')).toEqual([
      'engineer',
      'orchestrator',
      'reviewer',
    ]);
  });

  it('summarizes long identifiers without losing suffix context', () => {
    expect(summarizeIdentifier('1234567890abcdef1234')).toBe('12345678...1234');
    expect(summarizeIdentifier('short-id')).toBe('short-id');
  });
});
