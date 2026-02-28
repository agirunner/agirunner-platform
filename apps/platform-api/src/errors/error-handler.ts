import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { DomainError } from './domain-errors.js';
import { mapErrorToHttpStatus } from './http-errors.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id ?? randomUUID();
    const statusCode = mapErrorToHttpStatus(error);
    const domainError = error instanceof DomainError ? (error as DomainError) : null;

    request.log.error({ err: error, requestId }, 'request_failed');

    void reply.status(statusCode).send({
      error: {
        code: domainError?.code ?? 'INTERNAL_ERROR',
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
