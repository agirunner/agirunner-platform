import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import type { ApiKeyIdentity } from '../auth/api-key.js';

export interface RequestContext {
  requestId: string;
  sourceIp: string;
  auth?: ApiKeyIdentity;
  projectId?: string;
  workflowId?: string;
  taskId?: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function registerRequestContext(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => {
    const context: RequestContext = {
      requestId: request.headers['x-request-id']?.toString() ?? randomUUID(),
      sourceIp: resolveSourceIp(request),
    };
    request.id = context.requestId;
    requestContextStorage.run(context, done);
  });
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function setRequestAuthIdentity(identity: ApiKeyIdentity): void {
  const context = requestContextStorage.getStore();
  if (!context) {
    return;
  }
  context.auth = identity;
}

function resolveSourceIp(request: { headers: Record<string, unknown>; ip: string }): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return request.ip;
}
