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
import { createLoggedService } from '../logging/create-logged-service.js';
import { LogService } from '../logging/log-service.js';
import { LogLevelCache } from '../logging/log-level-cache.js';
import { LogStreamService } from '../logging/log-stream-service.js';
import { registerRequestLogger } from '../logging/request-logger.js';
import { registerRequestContext } from '../observability/request-context.js';
import { buildArtifactStorageConfig } from '../content/storage-config.js';
import { createArtifactStorage } from '../content/storage-factory.js';
import { AcpSessionService } from '../services/acp-session-service.js';
import { AgentService } from '../services/agent-service.js';
import { ApiKeyService } from '../services/api-key-service.js';
import { EventStreamService } from '../services/event-stream-service.js';
import { EventService } from '../services/event-service.js';
import { FleetService } from '../services/fleet-service.js';
import { IntegrationActionService } from '../services/integration-action-service.js';
import { IntegrationAdapterService } from '../services/integration-adapter-service.js';
import { startIntegrationDispatcher } from '../services/integration-dispatcher.js';
import { GovernanceService } from '../services/governance-service.js';
import { OAuthService } from '../services/oauth-service.js';
import { OrchestratorConfigService } from '../services/orchestrator-config-service.js';
import { OrchestratorGrantService } from '../services/orchestrator-grant-service.js';
import { ToolTagService } from '../services/tool-tag-service.js';
import { WebhookWorkItemTriggerService } from '../services/webhook-work-item-trigger-service.js';
import { ModelCatalogService } from '../services/model-catalog-service.js';
import { WorkspaceArtifactFileService } from '../services/workspace-artifact-file-service.js';
import { WorkspaceService } from '../services/workspace-service.js';
import { PlaybookService } from '../services/playbook-service.js';
import { RoleDefinitionService } from '../services/role-definition-service.js';
import { readPlatformTransportTimingDefaults } from '../services/platform-timing-defaults.js';
import { RuntimeDefaultsService } from '../services/runtime-defaults-service.js';
import { ScheduledWorkItemTriggerService } from '../services/scheduled-work-item-trigger-service.js';
import { TaskService } from '../services/task-service.js';
import { UserService } from '../services/user-service.js';
import { WorkerConnectionHub } from '../services/worker-connection-hub.js';
import { WorkerService } from '../services/worker-service.js';
import { WebhookService } from '../services/webhook-service.js';
import { WorkflowService } from '../services/workflow-service.js';
import { WorkflowActivationService } from '../services/workflow-activation-service.js';
import { WorkflowActivationDispatchService } from '../services/workflow-activation-dispatch-service.js';
import { seedConfigTables } from './seed.js';
import { registerPlugins } from './plugins.js';
import { registerRoutes } from './routes.js';
import { registerWebsocketGateway } from './websocket.js';
import { configureApiKeyLogging } from '../auth/api-key.js';
import { configureProviderSecretEncryptionKey } from '../lib/oauth-crypto.js';
import {
  applyDefaultTenantLoggingLevel,
  readDefaultTenantLoggingLevel,
} from '../logging/platform-log-level.js';

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
      { envName: 'DEFAULT_ADMIN_API_KEY', minLength: 1, requireFileInProduction: true },
      { envName: 'OPENAI_API_KEY', requireFileInProduction: true },
      { envName: 'AGIRUNNER_ADMIN_EMAIL' },
      { envName: 'AGIRUNNER_ADMIN_PASSWORD' },
    ],
    process.env,
  );

  assertRequiredStartupSecrets();
  const config = loadEnv(process.env);
  configureProviderSecretEncryptionKey(config.WEBHOOK_ENCRYPTION_KEY);

  const pool = createPool(config.DATABASE_URL);
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.join(currentDir, '..', 'db', 'migrations');
  await runMigrations(pool, migrationsDir);
  await seedDefaultTenant(pool, process.env);
  await seedConfigTables(pool, config);
  const platformTransportTimingDefaults = await readPlatformTransportTimingDefaults(pool);
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

  const eventService = new EventService(pool);
  const eventStreamService = new EventStreamService(pool);
  await eventStreamService.start();

  const logService = new LogService(pool);
  const logLevelCache = new LogLevelCache(pool, startupLogLevel);
  logService.setLevelFilter(logLevelCache);
  const logStreamService = new LogStreamService(pool);
  await logStreamService.start();

  const workerConnectionHub = new WorkerConnectionHub();
  const workerService = new WorkerService(pool, eventService, workerConnectionHub, appConfig);
  const webhookService = new WebhookService(pool, appConfig);
  const migratedWebhookSecrets = await webhookService.migratePlaintextSecrets();
  const taskService = new TaskService(pool, eventService, appConfig, workerConnectionHub, logService);
  await applyDefaultTenantLoggingLevel({
    governanceService,
    logger: app.log,
  });
  const integrationActionService = new IntegrationActionService(pool, taskService, appConfig);
  const integrationAdapterService = new IntegrationAdapterService(
    pool,
    appConfig,
    undefined,
    integrationActionService,
  );
  const workspaceService = new WorkspaceService(pool, eventService, appConfig);
  const workspaceArtifactFileService = new WorkspaceArtifactFileService(
    pool,
    createArtifactStorage(buildArtifactStorageConfig(appConfig)),
    appConfig.WORKSPACE_ARTIFACT_MAX_UPLOAD_FILES,
    appConfig.WORKSPACE_ARTIFACT_MAX_UPLOAD_BYTES,
  );
  const playbookService = new PlaybookService(pool);
  const workflowService = new WorkflowService(pool, eventService, appConfig, workerConnectionHub, logService);
  const workflowActivationService = new WorkflowActivationService(pool, eventService);
  const workflowActivationDispatchService = new WorkflowActivationDispatchService({
    pool,
    eventService,
    config: appConfig,
  });
  const userService = new UserService(pool);
  const apiKeyService = new ApiKeyService(pool);
  const orchestratorConfigService = new OrchestratorConfigService(pool);
  const roleDefinitionService = new RoleDefinitionService(pool);
  const fleetService = new FleetService(pool);
  const runtimeDefaultsService = new RuntimeDefaultsService(pool, fleetService, eventService);
  const modelCatalogService = new ModelCatalogService(pool);
  const oauthService = new OAuthService(pool);
  const orchestratorGrantService = new OrchestratorGrantService(pool, eventService);
  const toolTagService = new ToolTagService(pool);
  const agentService = new AgentService(pool, eventService);
  const acpSessionService = new AcpSessionService(pool, eventService);
  const webhookWorkItemTriggerService = new WebhookWorkItemTriggerService(
    pool,
    eventService,
    workflowService,
    appConfig.WEBHOOK_ENCRYPTION_KEY,
  );
  const scheduledWorkItemTriggerService = new ScheduledWorkItemTriggerService(
    pool,
    eventService,
    workflowService,
  );

  app.decorate('config', appConfig);
  app.decorate('pgPool', pool);
  app.decorate('logService', logService);
  app.decorate('logLevelCache', logLevelCache);
  app.decorate('logStreamService', logStreamService);
  app.decorate('eventService', eventService);
  app.decorate('eventStreamService', eventStreamService);
  app.decorate('integrationActionService', integrationActionService);
  app.decorate('integrationAdapterService', createLoggedService(integrationAdapterService, 'IntegrationAdapterService', logService));
  app.decorate('workerConnectionHub', workerConnectionHub);
  app.decorate('workerService', createLoggedService(workerService, 'WorkerService', logService));
  app.decorate('webhookService', createLoggedService(webhookService, 'WebhookService', logService));
  app.decorate('governanceService', createLoggedService(governanceService, 'GovernanceService', logService));
  app.decorate('workspaceService', createLoggedService(workspaceService, 'WorkspaceService', logService));
  app.decorate(
    'workspaceArtifactFileService',
    createLoggedService(workspaceArtifactFileService, 'WorkspaceArtifactFileService', logService),
  );
  app.decorate('playbookService', createLoggedService(playbookService, 'PlaybookService', logService));
  app.decorate('workflowService', createLoggedService(workflowService, 'WorkflowService', logService));
  app.decorate('workflowActivationService', createLoggedService(workflowActivationService, 'WorkflowActivationService', logService));
  app.decorate('taskService', createLoggedService(taskService, 'TaskService', logService));
  app.decorate('userService', createLoggedService(userService, 'UserService', logService));
  app.decorate('apiKeyService', createLoggedService(apiKeyService, 'ApiKeyService', logService));
  app.decorate('orchestratorConfigService', createLoggedService(orchestratorConfigService, 'OrchestratorConfigService', logService));
  app.decorate('roleDefinitionService', createLoggedService(roleDefinitionService, 'RoleDefinitionService', logService));
  app.decorate('runtimeDefaultsService', createLoggedService(runtimeDefaultsService, 'RuntimeDefaultsService', logService));
  app.decorate('fleetService', createLoggedService(fleetService, 'FleetService', logService));
  app.decorate('modelCatalogService', createLoggedService(modelCatalogService, 'ModelCatalogService', logService));
  app.decorate('oauthService', createLoggedService(oauthService, 'OAuthService', logService));
  app.decorate('orchestratorGrantService', createLoggedService(orchestratorGrantService, 'OrchestratorGrantService', logService));
  app.decorate('acpSessionService', createLoggedService(acpSessionService, 'AcpSessionService', logService));
  app.decorate('toolTagService', createLoggedService(toolTagService, 'ToolTagService', logService));
  app.decorate('webhookWorkItemTriggerService', createLoggedService(webhookWorkItemTriggerService, 'WebhookWorkItemTriggerService', logService));
  app.decorate('scheduledWorkItemTriggerService', createLoggedService(scheduledWorkItemTriggerService, 'ScheduledWorkItemTriggerService', logService));
  app.decorate('agentService', createLoggedService(agentService, 'AgentService', logService));

  if (migratedWebhookSecrets > 0) {
    app.log.info({ migratedWebhookSecrets }, 'webhook_secrets_migrated_to_encrypted_storage');
  }

  registerRequestContext(app);
  registerErrorHandler(app);
  registerRequestLogger(app, logService);
  await registerPlugins(app);
  await registerRoutes(app);
  registerWebsocketGateway(app);

  eventStreamService.subscribeAll({}, (event) => {
    void webhookService.deliverEvent(event).catch((error) => {
      app.log.error({ err: error, eventId: event.id, tenantId: event.tenant_id }, 'webhook_delivery_failed');
    });
  });

  const lifecycleMonitor = startLifecycleMonitor(
    app.log,
    pool,
    config,
    app.agentService,
    app.taskService,
    app.workerService,
    workflowActivationDispatchService,
    app.scheduledWorkItemTriggerService,
    app.fleetService,
    app.governanceService,
  );
  const integrationDispatcher = startIntegrationDispatcher(
    app.log,
    app.integrationAdapterService,
    eventStreamService,
  );

  app.addHook('onClose', async () => {
    integrationDispatcher.stop();
    lifecycleMonitor.stop();
    await eventStreamService.stop();
    await logStreamService.stop();
    await pool.end();
  });

  return app;
}
