import { describe, expect, it } from 'vitest';

import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '../../src/errors/domain-errors.js';
import { mapErrorToHttpStatus } from '../../src/errors/http-errors.js';

describe('error mapping', () => {
  it('maps known domain errors', () => {
    expect(mapErrorToHttpStatus(new ValidationError('bad'))).toBe(400);
    expect(mapErrorToHttpStatus(new UnauthorizedError())).toBe(401);
    expect(mapErrorToHttpStatus(new ForbiddenError())).toBe(403);
    expect(mapErrorToHttpStatus(new ConflictError())).toBe(409);
  });

  it('maps unknown errors to 500', () => {
    expect(mapErrorToHttpStatus(new Error('boom'))).toBe(500);
  });
});
