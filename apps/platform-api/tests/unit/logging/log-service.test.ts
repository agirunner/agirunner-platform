import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from '../../src/logging/log-service.js';

describe('LogService', () => {
  describe('cursor encoding', () => {
    it('roundTripsEncodeDecode', () => {
      const cursor = encodeCursor('12345', '2026-03-09T15:30:00.123Z');
      const decoded = decodeCursor(cursor);
      expect(decoded.id).toBe('12345');
      expect(decoded.createdAt).toBe('2026-03-09T15:30:00.123Z');
    });

    it('producesBase64UrlSafeCursor', () => {
      const cursor = encodeCursor('99999', '2026-03-09T15:30:00.123Z');
      expect(cursor).not.toMatch(/[+/=]/);
    });
  });
});
