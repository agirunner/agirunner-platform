import { describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/config/env.js';

describe('config validation', () => {
  it('accepts valid environment values', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      PORT: '9999',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(32),
      LOG_LEVEL: 'info',
    });

    expect(env.PORT).toBe(9999);
    expect(env.NODE_ENV).toBe('test');
  });

  it('rejects invalid configuration', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        PORT: 'abc',
        DATABASE_URL: '',
        JWT_SECRET: 'short',
        LOG_LEVEL: 'info',
      }),
    ).toThrowError();
  });
});
