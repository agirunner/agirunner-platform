import type { FastifyBaseLogger } from 'fastify';

import type { EventStreamService } from './event-stream-service.js';
import { IntegrationAdapterService } from './integration-adapter-service.js';

export interface IntegrationDispatcher {
  stop(): Promise<void>;
}

export function startIntegrationDispatcher(
  logger: FastifyBaseLogger,
  adapterService: IntegrationAdapterService,
  eventStreamService: EventStreamService,
): IntegrationDispatcher {
  const pending = new Set<Promise<void>>();
  let isStopping = false;

  const unsubscribe = eventStreamService.subscribeAll({}, (event) => {
    if (isStopping) {
      return;
    }

    const delivery = adapterService
      .deliverEvent(event)
      .catch((error) => {
        logger.error({ err: error, eventId: event.id, tenantId: event.tenant_id }, 'integration_dispatch_failed');
      })
      .finally(() => {
        pending.delete(delivery);
      });
    pending.add(delivery);
  });

  return {
    async stop() {
      isStopping = true;
      unsubscribe();
      await Promise.allSettled(pending);
    },
  };
}
