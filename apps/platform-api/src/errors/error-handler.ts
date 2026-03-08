import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';

import { DomainError } from './domain-errors.js';
import { mapErrorToHttpStatus } from './http-errors.js';

function fallbackCodeForStatus(statusCode: number): string {
  if (statusCode === 429) {
    return 'RATE_LIMITED';
  }

  if (statusCode === 503) {
    return 'SERVICE_UNAVAILABLE';
  }

  return 'INTERNAL_ERROR';
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id ?? randomUUID();

    if (error instanceof ZodError) {
      request.log.warn({ err: error, requestId }, 'validation_failed');
      void reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: { issues: error.flatten() },
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const statusCode = mapErrorToHttpStatus(error);
    const domainError = error instanceof DomainError ? (error as DomainError) : null;

    request.log.error({ err: error, requestId }, 'request_failed');

    void reply.status(statusCode).send({
      error: {
        code: domainError?.code ?? fallbackCodeForStatus(statusCode),
        message: domainError?.message ?? 'Internal server error',
        details: domainError?.details,
      },
      meta: {
        request_id: requestId,
        timestamp: new Date().toISOString(),
      },
    });
  });
}
