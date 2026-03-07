import type pg from 'pg';

import type { ApiKeyIdentity } from './auth/api-key.js';
import type { AppEnv } from './config/schema.js';
import type { EventStreamService } from './services/event-stream-service.js';
import type { EventService } from './services/event-service.js';
import type { IntegrationAdapterService } from './services/integration-adapter-service.js';
import type { WorkerConnectionHub } from './services/worker-connection-hub.js';
import type { WorkerService } from './services/worker-service.js';
import type { WebhookService } from './services/webhook-service.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppEnv;
    pgPool: pg.Pool;
    eventService: EventService;
    eventStreamService: EventStreamService;
    integrationAdapterService: IntegrationAdapterService;
    workerConnectionHub: WorkerConnectionHub;
    workerService: WorkerService;
    webhookService: WebhookService;
  }

  interface FastifyRequest {
    auth?: ApiKeyIdentity;
    rawBody?: Buffer;
  }
}
