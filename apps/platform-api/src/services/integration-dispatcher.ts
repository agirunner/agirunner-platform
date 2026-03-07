import type { FastifyBaseLogger } from 'fastify';

import type { EventStreamService } from './event-stream-service.js';
import { IntegrationAdapterService } from './integration-adapter-service.js';

export interface IntegrationDispatcher {
  stop(): void;
}

export function startIntegrationDispatcher(
  logger: FastifyBaseLogger,
  adapterService: IntegrationAdapterService,
  eventStreamService: EventStreamService,
): IntegrationDispatcher {
  const unsubscribe = eventStreamService.subscribeAll({}, (event) => {
    void adapterService.deliverEvent(event).catch((error) => {
      logger.error({ err: error, eventId: event.id, tenantId: event.tenant_id }, 'integration_dispatch_failed');
    });
  });

  return {
    stop() {
      unsubscribe();
    },
  };
}
