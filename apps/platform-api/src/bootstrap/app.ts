import Fastify from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from '../config/env.js';
import { createPool } from '../db/client.js';
import { runMigrations } from '../db/migrations/run-migrations.js';
import { seedDefaultTenant } from '../db/seed.js';
import { registerErrorHandler } from '../errors/error-handler.js';
import { startLifecycleMonitor } from '../jobs/lifecycle-monitor.js';
import { registerRequestContext } from '../observability/request-context.js';
import { AgentService } from '../services/agent-service.js';
import { EventStreamService } from '../services/event-stream-service.js';
import { EventService } from '../services/event-service.js';
import { TaskService } from '../services/task-service.js';
import { WorkerConnectionHub } from '../services/worker-connection-hub.js';
import { WorkerService } from '../services/worker-service.js';
import { WebhookService } from '../services/webhook-service.js';
import { registerPlugins } from './plugins.js';
import { registerRoutes } from './routes.js';
import { registerWebsocketGateway } from './websocket.js';

export async function buildApp() {
  const config = loadEnv();
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  const pool = createPool(config.DATABASE_URL);
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.join(currentDir, '..', 'db', 'migrations');
  await runMigrations(pool, migrationsDir);
  await seedDefaultTenant(pool);

  const eventService = new EventService(pool);
  const eventStreamService = new EventStreamService(pool);
  await eventStreamService.start();

  const workerConnectionHub = new WorkerConnectionHub();
  const workerService = new WorkerService(pool, eventService, workerConnectionHub, config);
  const webhookService = new WebhookService(pool, config);

  app.decorate('config', config);
  app.decorate('pgPool', pool);
  app.decorate('eventService', eventService);
  app.decorate('eventStreamService', eventStreamService);
  app.decorate('workerConnectionHub', workerConnectionHub);
  app.decorate('workerService', workerService);
  app.decorate('webhookService', webhookService);

  registerRequestContext(app);
  await registerPlugins(app);
  await registerRoutes(app);
  registerWebsocketGateway(app);
  registerErrorHandler(app);

  eventStreamService.subscribeAll({}, (event) => {
    void webhookService.deliverEvent(event).catch((error) => {
      app.log.error({ err: error, eventId: event.id, tenantId: event.tenant_id }, 'webhook_delivery_failed');
    });
  });

  const agentService = new AgentService(pool, eventService, config);
  const taskService = new TaskService(pool, eventService, config);
  const lifecycleMonitor = startLifecycleMonitor(app.log, config, agentService, taskService, workerService);

  app.addHook('onClose', async () => {
    lifecycleMonitor.stop();
    await eventStreamService.stop();
    await pool.end();
  });

  return app;
}
