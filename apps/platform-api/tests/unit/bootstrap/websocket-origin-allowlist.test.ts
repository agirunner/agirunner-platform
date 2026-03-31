import { describe, expect, it } from 'vitest';

import { isOriginAllowed } from '../../../src/bootstrap/websocket.js';

describe('isOriginAllowed', () => {
  it('allows any origin when configured with a wildcard', () => {
    expect(isOriginAllowed('https://worker.example.com', '*')).toBe(true);
    expect(isOriginAllowed(undefined, '*')).toBe(true);
    expect(isOriginAllowed('http://any-host.internal', '*')).toBe(true);
  });

  it('restricts origins when a concrete allowlist is configured', () => {
    const config = 'https://workers.corp.example.com, http://localhost:3000';

    expect(isOriginAllowed('https://workers.corp.example.com', config)).toBe(true);
    expect(isOriginAllowed('https://attacker.example.com', config)).toBe(false);
    expect(isOriginAllowed(undefined, config)).toBe(true);
  });
});
