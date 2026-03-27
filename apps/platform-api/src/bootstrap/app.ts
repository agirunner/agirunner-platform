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
import { ContainerInventoryService } from '../services/container-inventory-service.js';
import { DestructiveDeleteService } from '../services/destructive-delete-service.js';
import { ContainerManagerExecutionEnvironmentVerifier } from '../services/container-manager-execution-environment-verifier.js';
import { EventStreamService } from '../services/event-stream-service.js';
import { EventService } from '../services/event-service.js';
import { ExecutionEnvironmentCatalogService } from '../services/execution-environment-catalog-service.js';
import { ExecutionEnvironmentService } from '../services/execution-environment-service.js';
import { ExecutionEnvironmentVerificationService } from '../services/execution-environment-verification-service.js';
import { FleetService } from '../services/fleet-service.js';
import { GovernanceService } from '../services/governance-service.js';
import { OAuthService } from '../services/oauth-service.js';
import { OrchestratorConfigService } from '../services/orchestrator-config-service.js';
import { OrchestratorGrantService } from '../services/orchestrator-grant-service.js';
import { ToolTagService } from '../services/tool-tag-service.js';
import { ModelCatalogService } from '../services/model-catalog-service.js';
import { RemoteMcpOAuthClientProfileService } from '../services/remote-mcp-oauth-client-profile-service.js';
import { RemoteMcpServerService } from '../services/remote-mcp-server-service.js';
import { RemoteMcpHttpVerifier } from '../services/remote-mcp-http-verifier.js';
import { RemoteMcpOAuthService } from '../services/remote-mcp-oauth-service.js';
import { RemoteMcpVerificationService } from '../services/remote-mcp-verification-service.js';
import { SpecialistSkillService } from '../services/specialist-skill-service.js';
import { WorkspaceArtifactFileService } from '../services/workspace-artifact-file-service.js';
import { WorkspaceService } from '../services/workspace-service.js';
import { PlaybookService } from '../services/playbook-service.js';
import { RoleDefinitionService } from '../services/role-definition-service.js';
import { readPlatformTransportTimingDefaults } from '../services/platform-timing-defaults.js';
import { RuntimeDefaultsService } from '../services/runtime-defaults-service.js';
import { TaskService } from '../services/task-service.js';
import { UserService } from '../services/user-service.js';
import { WorkerConnectionHub } from '../services/worker-connection-hub.js';
import { WorkerService } from '../services/worker-service.js';
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
  const containerInventoryService = new ContainerInventoryService(pool);

  const logService = new LogService(pool);
  const logLevelCache = new LogLevelCache(pool, startupLogLevel);
  logService.setLevelFilter(logLevelCache);
  const logStreamService = new LogStreamService(pool);
  await logStreamService.start();

  const workerConnectionHub = new WorkerConnectionHub();
  const workerService = new WorkerService(pool, eventService, workerConnectionHub, appConfig);
  const taskService = new TaskService(pool, eventService, appConfig, workerConnectionHub, logService);
  const artifactStorage = createArtifactStorage(buildArtifactStorageConfig(appConfig));
  await applyDefaultTenantLoggingLevel({
    governanceService,
    logger: app.log,
  });
  const workspaceArtifactFileService = new WorkspaceArtifactFileService(
    pool,
    artifactStorage,
    appConfig.WORKSPACE_ARTIFACT_MAX_UPLOAD_FILES,
    appConfig.WORKSPACE_ARTIFACT_MAX_UPLOAD_BYTES,
  );
  const workflowService = new WorkflowService(
    pool,
    eventService,
    appConfig,
    workerConnectionHub,
    logService,
    taskService,
  );
  const destructiveDeleteService = new DestructiveDeleteService(pool, {
    cancelWorkflow: workflowService.cancelWorkflow.bind(workflowService),
    cancelTask: taskService.cancelTask.bind(taskService),
    artifactStorage,
  });
  const workspaceService = new WorkspaceService(pool, eventService, appConfig, {
    destructiveDeleteService,
  });
  const playbookService = new PlaybookService(pool, {
    destructiveDeleteService,
  });
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
  const executionEnvironmentCatalogService = new ExecutionEnvironmentCatalogService(pool);
  const executionEnvironmentService = new ExecutionEnvironmentService(
    pool,
    executionEnvironmentCatalogService,
  );
  const executionEnvironmentVerifier = new ContainerManagerExecutionEnvironmentVerifier(
    appConfig.CONTAINER_MANAGER_CONTROL_URL,
    appConfig.CONTAINER_MANAGER_CONTROL_TOKEN ?? null,
  );
  const executionEnvironmentVerificationService = new ExecutionEnvironmentVerificationService(
    pool,
    executionEnvironmentService,
    executionEnvironmentVerifier,
  );
  const modelCatalogService = new ModelCatalogService(pool);
  const oauthService = new OAuthService(pool);
  const remoteMcpOAuthClientProfileService = new RemoteMcpOAuthClientProfileService(pool);
  const remoteMcpServerService = new RemoteMcpServerService(pool);
  const remoteMcpVerifier = new RemoteMcpHttpVerifier();
  const remoteMcpOAuthService = new RemoteMcpOAuthService(
    pool,
    remoteMcpServerService,
    remoteMcpVerifier,
    {
      platformPublicBaseUrl: appConfig.PLATFORM_PUBLIC_BASE_URL,
      remoteMcpHostedCallbackBaseUrl: appConfig.REMOTE_MCP_HOSTED_CALLBACK_BASE_URL,
    },
    remoteMcpOAuthClientProfileService,
  );
  const remoteMcpVerificationService = new RemoteMcpVerificationService(
    remoteMcpServerService,
    remoteMcpVerifier,
    remoteMcpOAuthService,
  );
  const specialistSkillService = new SpecialistSkillService(pool);
  const orchestratorGrantService = new OrchestratorGrantService(pool, eventService);
  const toolTagService = new ToolTagService(pool);
  const agentService = new AgentService(pool, eventService);
  const acpSessionService = new AcpSessionService(pool, eventService);

  app.decorate('config', appConfig);
  app.decorate('pgPool', pool);
  app.decorate('logService', logService);
  app.decorate('logLevelCache', logLevelCache);
  app.decorate('logStreamService', logStreamService);
  app.decorate('eventService', eventService);
  app.decorate('eventStreamService', eventStreamService);
  app.decorate(
    'containerInventoryService',
    createLoggedService(containerInventoryService, 'ContainerInventoryService', logService),
  );
  app.decorate('workerConnectionHub', workerConnectionHub);
  app.decorate('workerService', createLoggedService(workerService, 'WorkerService', logService));
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
  app.decorate(
    'executionEnvironmentCatalogService',
    createLoggedService(
      executionEnvironmentCatalogService,
      'ExecutionEnvironmentCatalogService',
      logService,
    ),
  );
  app.decorate(
    'executionEnvironmentService',
    createLoggedService(executionEnvironmentService, 'ExecutionEnvironmentService', logService),
  );
  app.decorate(
    'executionEnvironmentVerificationService',
    createLoggedService(
      executionEnvironmentVerificationService,
      'ExecutionEnvironmentVerificationService',
      logService,
    ),
  );
  app.decorate('fleetService', createLoggedService(fleetService, 'FleetService', logService));
  app.decorate('modelCatalogService', createLoggedService(modelCatalogService, 'ModelCatalogService', logService));
  app.decorate('oauthService', createLoggedService(oauthService, 'OAuthService', logService));
  app.decorate('remoteMcpOAuthClientProfileService', createLoggedService(remoteMcpOAuthClientProfileService, 'RemoteMcpOAuthClientProfileService', logService));
  app.decorate('remoteMcpServerService', createLoggedService(remoteMcpServerService, 'RemoteMcpServerService', logService));
  app.decorate('remoteMcpOAuthService', createLoggedService(remoteMcpOAuthService, 'RemoteMcpOAuthService', logService));
  app.decorate('remoteMcpVerificationService', createLoggedService(remoteMcpVerificationService, 'RemoteMcpVerificationService', logService));
  app.decorate('specialistSkillService', createLoggedService(specialistSkillService, 'SpecialistSkillService', logService));
  app.decorate('orchestratorGrantService', createLoggedService(orchestratorGrantService, 'OrchestratorGrantService', logService));
  app.decorate('acpSessionService', createLoggedService(acpSessionService, 'AcpSessionService', logService));
  app.decorate('toolTagService', createLoggedService(toolTagService, 'ToolTagService', logService));
  app.decorate('agentService', createLoggedService(agentService, 'AgentService', logService));

  registerRequestContext(app);
  registerErrorHandler(app);
  registerRequestLogger(app, logService);
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
    workflowActivationDispatchService,
    app.fleetService,
    app.governanceService,
  );

  app.addHook('onClose', async () => {
    lifecycleMonitor.stop();
    await eventStreamService.stop();
    await logStreamService.stop();
    await pool.end();
  });

  return app;
}
