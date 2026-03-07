import { describe, expect, it, vi } from 'vitest';

import { UnauthorizedError } from '../../src/errors/domain-errors.js';
import { authenticateApiKey } from '../../src/auth/fastify-auth-hook.js';

vi.mock('../../src/auth/jwt.js', () => ({
  verifyJwt: vi.fn(async () => {
    const error = new Error('expired');
    (error as Error & { code: string }).code = 'FAST_JWT_EXPIRED';
    throw error;
  }),
}));

vi.mock('../../src/auth/api-key.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/auth/api-key.js')>(
    '../../src/auth/api-key.js',
  );
  return {
    ...actual,
    verifyApiKey: vi.fn(),
  };
});

describe('authenticateApiKey', () => {
  it('maps expired JWT verification failures to UnauthorizedError', async () => {
    const request = {
      headers: {
        authorization: 'Bearer header.payload.signature',
      },
      cookies: {},
      url: '/test',
      method: 'GET',
      server: {
        pgPool: {},
        auditService: { record: vi.fn().mockResolvedValue(undefined) },
      },
      auth: undefined,
    } as never;

    await expect(authenticateApiKey(request)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
