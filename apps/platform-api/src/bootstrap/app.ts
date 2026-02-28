import Fastify from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from '../config/env.js';
import { registerErrorHandler } from '../errors/error-handler.js';
import { createPool } from '../db/client.js';
import { runMigrations } from '../db/migrations/run-migrations.js';
import { seedDefaultTenant } from '../db/seed.js';
import { registerRequestContext } from '../observability/request-context.js';
import { AgentService } from '../services/agent-service.js';
import { EventService } from '../services/event-service.js';
import { TaskService } from '../services/task-service.js';
import { startLifecycleMonitor } from '../jobs/lifecycle-monitor.js';
import { registerPlugins } from './plugins.js';
import { registerRoutes } from './routes.js';

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

  app.decorate('config', config);
  app.decorate('pgPool', pool);

  registerRequestContext(app);
  await registerPlugins(app);
  await registerRoutes(app);
  registerErrorHandler(app);

  const eventService = new EventService(pool);
  const agentService = new AgentService(pool, eventService);
  const taskService = new TaskService(pool, eventService);
  const lifecycleMonitor = startLifecycleMonitor(app.log, agentService, taskService);

  app.addHook('onClose', async () => {
    lifecycleMonitor.stop();
    await pool.end();
  });

  return app;
}
