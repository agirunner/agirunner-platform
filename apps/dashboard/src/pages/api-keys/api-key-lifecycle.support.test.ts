import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatAbsoluteTimestamp,
  formatDateLabel,
  formatExpiryLabel,
  formatRelativeTimestamp,
  isWithinDays,
} from './api-key-lifecycle.support.js';

describe('api key lifecycle support', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats relative timestamps for glanceable governance rows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-13T18:00:00.000Z'));

    expect(formatRelativeTimestamp('2026-03-13T17:55:00.000Z')).toBe('5m ago');
    expect(formatRelativeTimestamp('2026-03-13T12:00:00.000Z')).toBe('6h ago');
    expect(formatRelativeTimestamp('2026-03-10T18:00:00.000Z')).toBe('3d ago');
    expect(formatRelativeTimestamp(null)).toBe('Never');
  });

  it('formats expiry labels and expiring-soon detection for destructive review states', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-13T18:00:00.000Z'));

    expect(formatExpiryLabel('2026-03-13T20:00:00.000Z')).toBe('Today');
    expect(formatExpiryLabel('2026-03-15T18:00:00.000Z')).toBe('In 2d');
    expect(formatExpiryLabel('2026-03-10T18:00:00.000Z')).toBe('Expired 3d ago');
    expect(isWithinDays('2026-03-18T18:00:00.000Z', 7)).toBe(true);
    expect(isWithinDays('2026-03-30T18:00:00.000Z', 7)).toBe(false);
  });

  it('keeps absolute date outputs available for hover detail', () => {
    expect(formatDateLabel('2026-03-12T03:04:05.000Z')).toContain('2026');
    expect(formatAbsoluteTimestamp('2026-03-12T03:04:05.000Z')).toContain('2026');
  });
});
