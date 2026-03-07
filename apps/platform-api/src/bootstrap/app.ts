import Fastify from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from '../config/env.js';
import { resolveSecretEnv } from '../config/secret-env.js';
import { createPool } from '../db/client.js';
import { runMigrations } from '../db/migrations/run-migrations.js';
import { seedDefaultTenant } from '../db/seed.js';
import { registerErrorHandler } from '../errors/error-handler.js';
import { startLifecycleMonitor } from '../jobs/lifecycle-monitor.js';
import { registerRequestContext } from '../observability/request-context.js';
import { AgentService } from '../services/agent-service.js';
import { EventStreamService } from '../services/event-stream-service.js';
import { EventService } from '../services/event-service.js';
import { IntegrationAdapterService } from '../services/integration-adapter-service.js';
import { startIntegrationDispatcher } from '../services/integration-dispatcher.js';
import { TaskService } from '../services/task-service.js';
import { WorkerConnectionHub } from '../services/worker-connection-hub.js';
import { WorkerService } from '../services/worker-service.js';
import { WebhookService } from '../services/webhook-service.js';
import { registerPlugins } from './plugins.js';
import { registerRoutes } from './routes.js';
import { registerWebsocketGateway } from './websocket.js';

function requireSecretValue(source: NodeJS.ProcessEnv, envName: 'JWT_SECRET' | 'WEBHOOK_ENCRYPTION_KEY'): string {
  const secretValue = source[envName];

  if (!secretValue || secretValue.trim().length === 0) {
    throw new Error(`Missing required environment variable ${envName}. Set ${envName} before starting platform-api.`);
  }

  return secretValue;
}

function assertSecretMinLength(secretValue: string, envName: string, minLength: number): void {
  if (secretValue.trim().length < minLength) {
    throw new Error(`${envName} must be at least ${minLength} characters long.`);
  }
}

export function assertRequiredStartupSecrets(source: NodeJS.ProcessEnv = process.env): void {
  const jwtSecret = requireSecretValue(source, 'JWT_SECRET');
  const webhookEncryptionKey = requireSecretValue(source, 'WEBHOOK_ENCRYPTION_KEY');

  assertSecretMinLength(jwtSecret, 'JWT_SECRET', 32);
  assertSecretMinLength(webhookEncryptionKey, 'WEBHOOK_ENCRYPTION_KEY', 32);
}

export async function buildApp() {
  resolveSecretEnv(
    process.env,
    [
      { envName: 'JWT_SECRET', required: true, minLength: 32, requireFileInProduction: true },
      { envName: 'WEBHOOK_ENCRYPTION_KEY', required: true, minLength: 32, requireFileInProduction: true },
      { envName: 'DEFAULT_ADMIN_API_KEY', minLength: 20, requireFileInProduction: true },
      { envName: 'OPENAI_API_KEY', requireFileInProduction: true },
    ],
    process.env,
  );

  assertRequiredStartupSecrets();
  const config = loadEnv(process.env);
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  const pool = createPool(config.DATABASE_URL);
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.join(currentDir, '..', 'db', 'migrations');
  await runMigrations(pool, migrationsDir);
  await seedDefaultTenant(pool, process.env);

  const eventService = new EventService(pool);
  const eventStreamService = new EventStreamService(pool);
  await eventStreamService.start();
  const integrationAdapterService = new IntegrationAdapterService(pool, config);

  const workerConnectionHub = new WorkerConnectionHub();
  const workerService = new WorkerService(pool, eventService, workerConnectionHub, config);
  const webhookService = new WebhookService(pool, config);
  const migratedWebhookSecrets = await webhookService.migratePlaintextSecrets();

  app.decorate('config', config);
  app.decorate('pgPool', pool);
  app.decorate('eventService', eventService);
  app.decorate('eventStreamService', eventStreamService);
  app.decorate('integrationAdapterService', integrationAdapterService);
  app.decorate('workerConnectionHub', workerConnectionHub);
  app.decorate('workerService', workerService);
  app.decorate('webhookService', webhookService);

  if (migratedWebhookSecrets > 0) {
    app.log.info({ migratedWebhookSecrets }, 'webhook_secrets_migrated_to_encrypted_storage');
  }

  registerRequestContext(app);
  registerErrorHandler(app);
  await registerPlugins(app);
  await registerRoutes(app);
  registerWebsocketGateway(app);

  eventStreamService.subscribeAll({}, (event) => {
    void webhookService.deliverEvent(event).catch((error) => {
      app.log.error({ err: error, eventId: event.id, tenantId: event.tenant_id }, 'webhook_delivery_failed');
    });
  });

  const agentService = new AgentService(pool, eventService, config);
  const taskService = new TaskService(pool, eventService, config, workerConnectionHub);
  const lifecycleMonitor = startLifecycleMonitor(app.log, config, agentService, taskService, workerService);
  const integrationDispatcher = startIntegrationDispatcher(
    app.log,
    integrationAdapterService,
    eventStreamService,
  );

  app.addHook('onClose', async () => {
    integrationDispatcher.stop();
    lifecycleMonitor.stop();
    await eventStreamService.stop();
    await pool.end();
  });

  return app;
}
