import { describe, expect, it } from 'vitest';

import { formatLogRelativeTime } from './log-time.js';

describe('log time', () => {
  it('formats compact relative timestamps consistently', () => {
    const now = new Date('2026-03-14T03:53:00.000Z').getTime();

    expect(formatLogRelativeTime('2026-03-14T03:52:58.000Z', now)).toBe('just now');
    expect(formatLogRelativeTime('2026-03-14T03:52:15.000Z', now)).toBe('45s ago');
    expect(formatLogRelativeTime('2026-03-14T03:38:00.000Z', now)).toBe('15m ago');
    expect(formatLogRelativeTime('2026-03-14T00:53:00.000Z', now)).toBe('3h ago');
    expect(formatLogRelativeTime('2026-03-10T03:53:00.000Z', now)).toBe('4d ago');
  });

  it('handles future and invalid timestamps', () => {
    const now = new Date('2026-03-14T03:53:00.000Z').getTime();

    expect(formatLogRelativeTime('2026-03-14T03:53:45.000Z', now)).toBe('in 45s');
    expect(formatLogRelativeTime('not-a-date', now)).toBe('Unknown time');
  });
});
