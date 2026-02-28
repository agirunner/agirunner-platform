import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

export function registerRequestContext(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => {
    request.id = request.headers['x-request-id']?.toString() ?? randomUUID();
    done();
  });
}
