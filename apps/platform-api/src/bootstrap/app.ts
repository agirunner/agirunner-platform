import Fastify from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { configureApiKeyLogging } from '../auth/api-key.js';
import { loadEnv } from '../config/env.js';
import { resolveSecretEnv } from '../config/secret-env.js';
import { createPool } from '../db/client.js';
import { runMigrations } from '../db/migrations/run-migrations.js';
import { registerPoolErrorLogging, runDatabaseStartupWithRetry } from '../db/startup-resilience.js';
import { seedDefaultTenant } from '../db/seed.js';
import { registerErrorHandler } from '../errors/error-handler.js';
import { startLifecycleMonitor } from '../jobs/lifecycle-monitor.js';
import { readDefaultTenantLoggingLevel } from '../logging/execution/platform-log-level.js';
import { registerRequestLogger } from '../logging/request/request-logger.js';
import { registerRequestContext } from '../observability/request-context.js';
import { GovernanceService } from '../services/governance-service.js';
import { readPlatformTransportTimingDefaults } from '../services/platform-config/platform-timing-defaults.js';
import { configureProviderSecretEncryptionKey } from '../lib/oauth-crypto.js';
import { buildAppServices } from './app-services.js';
import { registerCommunityCatalogServices } from './community-catalog-services.js';
import { decorateAppServices } from './decorate-app-services.js';
import { registerPlugins } from './plugins.js';
import { registerRoutes } from './routes.js';
import { seedConfigTables } from './seed.js';
import { assertRequiredStartupSecrets } from './startup-secrets.js';
import { registerWebsocketGateway } from './websocket.js';
export { assertRequiredStartupSecrets } from './startup-secrets.js';

export async function buildApp() {
  resolveSecretEnv(
    process.env,
    [
      { envName: 'JWT_SECRET', required: true, minLength: 32 },
      { envName: 'WEBHOOK_ENCRYPTION_KEY', required: true, minLength: 32 },
      { envName: 'DEFAULT_ADMIN_API_KEY', minLength: 1 },
      { envName: 'OPENAI_API_KEY' },
      { envName: 'AGIRUNNER_ADMIN_EMAIL' },
      { envName: 'AGIRUNNER_ADMIN_PASSWORD' },
    ],
    process.env,
  );

  assertRequiredStartupSecrets();
  const config = loadEnv(process.env);
  configureProviderSecretEncryptionKey(config.WEBHOOK_ENCRYPTION_KEY);

  const pool = createPool(config.DATABASE_URL);
  registerPoolErrorLogging(pool, console, 'platform database pool');
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.join(currentDir, '..', 'db', 'migrations');
  await runDatabaseStartupWithRetry(
    async () => {
      await runMigrations(pool, migrationsDir);
      await seedDefaultTenant(pool, process.env);
      await seedConfigTables(pool, config);
    },
    {
      logger: console,
      label: 'platform database bootstrap',
    },
  );
  const platformTransportTimingDefaults = await runDatabaseStartupWithRetry(
    () => readPlatformTransportTimingDefaults(pool),
    {
      logger: console,
      label: 'platform transport timing defaults',
    },
  );
  const appConfig = {
    ...config,
    ...platformTransportTimingDefaults,
  };
  const governanceService = new GovernanceService(pool, config);
  const startupLogLevel = await readDefaultTenantLoggingLevel(governanceService);
  configureApiKeyLogging(startupLogLevel);
  const app = Fastify({
    logger: {
      level: startupLogLevel,
    },
  });
  const services = await buildAppServices({
    app,
    config: appConfig,
    governanceService,
    pool,
    startupLogLevel,
  });
  registerCommunityCatalogServices({
    app,
    config: appConfig,
    containerManagerVersionReader: services.containerManagerVersionReader,
    logService: services.logService,
    playbookService: services.playbookService,
    pool,
    roleDefinitionService: services.roleDefinitionService,
    specialistSkillService: services.specialistSkillService,
  });
  decorateAppServices({
    app,
    config: appConfig,
    pool,
    services,
  });

  registerRequestContext(app);
  registerErrorHandler(app);
  registerRequestLogger(app, services.logService);
  await registerPlugins(app);
  await registerRoutes(app);
  registerWebsocketGateway(app);

  const lifecycleMonitor = startLifecycleMonitor(
    app.log,
    pool,
    config,
    app.agentService,
    app.taskService,
    app.workerService,
    services.workflowActivationDispatchService,
    app.fleetService,
    app.governanceService,
  );

  app.addHook('onClose', async () => {
    lifecycleMonitor.stop();
    await services.eventStreamService.stop();
    await services.logStreamService.stop();
    await pool.end();
  });

  return app;
}
