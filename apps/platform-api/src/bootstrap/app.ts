import Fastify from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from '../config/env.js';
import { resolveSecretEnv } from '../config/secret-env.js';
import { createPool } from '../db/client.js';
import { runMigrations } from '../db/migrations/run-migrations.js';
import {
  registerPoolErrorLogging,
  runDatabaseListenerStartupWithRetry,
  runDatabaseStartupWithRetry,
} from '../db/startup-resilience.js';
import { seedDefaultTenant } from '../db/seed.js';
import { registerErrorHandler } from '../errors/error-handler.js';
import { startLifecycleMonitor } from '../jobs/lifecycle-monitor.js';
import { createLoggedService } from '../logging/execution/create-logged-service.js';
import { LogService } from '../logging/execution/log-service.js';
import { LogLevelCache } from '../logging/execution/log-level-cache.js';
import { LogStreamService } from '../logging/execution/log-stream-service.js';
import { registerRequestLogger } from '../logging/request/request-logger.js';
import { registerRequestContext } from '../observability/request-context.js';
import { buildArtifactStorageConfig } from '../content/storage-config.js';
import { createArtifactStorage } from '../content/storage-factory.js';
import { AcpSessionService } from '../services/acp-session-service.js';
import { AgentService } from '../services/agent-service.js';
import { AgenticSettingsService } from '../services/platform-config/agentic-settings-service.js';
import { ApiKeyService } from '../services/api-key-service.js';
import { ContainerInventoryService } from '../services/execution-environment/container-inventory-service.js';
import { DestructiveDeleteService } from '../services/destructive-delete/destructive-delete-service.js';
import { ContainerManagerExecutionEnvironmentVerifier } from '../services/execution-environment/container-manager-verifier.js';
import { listWorkflowDocuments } from '../services/document-reference/document-reference-service.js';
import { EventStreamService } from '../services/event/event-stream-service.js';
import { EventService } from '../services/event/event-service.js';
import { ExecutionEnvironmentCatalogService } from '../services/execution-environment/catalog-service.js';
import { ExecutionEnvironmentService } from '../services/execution-environment/service.js';
import { ExecutionEnvironmentVerificationService } from '../services/execution-environment/verification-service.js';
import { FleetService } from '../services/fleet-service/fleet-service.js';
import { GovernanceService } from '../services/governance-service.js';
import { ApprovalQueueService } from '../services/approval-queue-service/approval-queue-service.js';
import { MissionControlHistoryService } from '../services/workflow-operations/mission-control/history-service.js';
import { MissionControlLiveService } from '../services/workflow-operations/mission-control/live-service.js';
import { MissionControlRecentService } from '../services/workflow-operations/mission-control/recent-service.js';
import { WorkflowDeliverablesService } from '../services/workflow-operations/workflow-deliverables-service.js';
import { WorkflowHistoryService } from '../services/workflow-operations/workflow-history-service.js';
import { WorkflowBriefsService } from '../services/workflow-operations/workflow-briefs-service.js';
import { WorkflowLiveConsoleService } from '../services/workflow-operations/workflow-live-console-service.js';
import { WorkflowOperationsStreamService } from '../services/workflow-operations/workflow-operations-stream-service.js';
import { WorkflowRailService } from '../services/workflow-operations/workflow-rail-service.js';
import { WorkflowWorkspaceService } from '../services/workflow-operations/workflow-workspace-service.js';
import { OAuthService } from '../services/oauth/oauth-service.js';
import { OrchestratorConfigService } from '../services/orchestrator/orchestrator-config-service.js';
import { OrchestratorGrantService } from '../services/orchestrator/orchestrator-grant-service.js';
import { ToolTagService } from '../services/tool-tag-service.js';
import { ContainerManagerVersionReader } from '../services/system-version/container-manager-version-reader.js';
import { ModelCatalogService } from '../services/model-catalog/model-catalog-service.js';
import { RemoteMcpOAuthClientProfileService } from '../services/remote-mcp/oauth/remote-mcp-oauth-client-profile-service.js';
import { RemoteMcpServerService } from '../services/remote-mcp/servers/remote-mcp-server-service.js';
import { RemoteMcpHttpVerifier } from '../services/remote-mcp/verification/remote-mcp-http-verifier.js';
import { RemoteMcpOAuthService } from '../services/remote-mcp/oauth/remote-mcp-oauth-service.js';
import { RemoteMcpVerificationService } from '../services/remote-mcp/verification/remote-mcp-verification-service.js';
import { SpecialistSkillService } from '../services/specialist/specialist-skill-service.js';
import { WorkspaceArtifactFileService } from '../services/workspace/artifacts/workspace-artifact-file-service.js';
import { WorkspaceService } from '../services/workspace/workspace-service.js';
import { PlaybookService } from '../services/playbook/playbook-service.js';
import { RoleDefinitionService } from '../services/role-definition/role-definition-service.js';
import { readPlatformTransportTimingDefaults } from '../services/platform-config/platform-timing-defaults.js';
import { RuntimeDefaultsService } from '../services/runtime-defaults/runtime-defaults-service.js';
import { TaskService } from '../services/task/task-service.js';
import { UserService } from '../services/user-service.js';
import { WorkerConnectionHub } from '../services/workers/worker-connection-hub.js';
import { WorkerService } from '../services/workers/worker-service.js';
import { WorkflowService } from '../services/workflow-service/workflow-service.js';
import { WorkflowActivationService } from '../services/workflow-activation/workflow-activation-service.js';
import { WorkflowActivationDispatchService } from '../services/workflow-activation-dispatch/workflow-activation-dispatch-service.js';
import { WorkflowDeliverableService } from '../services/workflow-deliverables/workflow-deliverable-service.js';
import { WorkflowDeliverableHandoffService } from '../services/workflow-deliverables/workflow-deliverable-handoff-service.js';
import { WorkflowDeliverableLifecycleService } from '../services/workflow-deliverables/workflow-deliverable-lifecycle-service.js';
import { WorkflowInputPacketService } from '../services/workflow-operations/workflow-input-packet-service.js';
import { WorkflowInterventionService } from '../services/workflow-operations/workflow-intervention-service.js';
import { WorkflowOperatorBriefService } from '../services/workflow-operator/workflow-operator-brief-service.js';
import { WorkflowOperatorUpdateService } from '../services/workflow-operator/workflow-operator-update-service.js';
import { WorkflowRedriveService } from '../services/workflow-service/workflow-redrive-service.js';
import { WorkflowSettingsService } from '../services/workflow-operations/workflow-settings-service.js';
import { WorkflowSteeringSessionService } from '../services/workflow-steering-session-service/workflow-steering-session-service.js';
import { seedConfigTables } from './seed.js';
import { registerPlugins } from './plugins.js';
import { registerRoutes } from './routes.js';
import { assertRequiredStartupSecrets } from './startup-secrets.js';
import { registerCommunityCatalogServices } from './community-catalog-services.js';
import { registerWebsocketGateway } from './websocket.js';
import { configureApiKeyLogging } from '../auth/api-key.js';
import { configureProviderSecretEncryptionKey } from '../lib/oauth-crypto.js';
import {
  applyDefaultTenantLoggingLevel,
  readDefaultTenantLoggingLevel,
} from '../logging/execution/platform-log-level.js';
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
  await runDatabaseStartupWithRetry(async () => {
    await runMigrations(pool, migrationsDir);
    await seedDefaultTenant(pool, process.env);
    await seedConfigTables(pool, config);
  }, {
    logger: console,
    label: 'platform database bootstrap',
  });
  const platformTransportTimingDefaults = await runDatabaseStartupWithRetry(() => readPlatformTransportTimingDefaults(pool), {
    logger: console,
    label: 'platform transport timing defaults',
  });
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
  await runDatabaseListenerStartupWithRetry(() => eventStreamService.start(), {
    logger: console,
    label: 'platform event stream listener',
  });
  const containerInventoryService = new ContainerInventoryService(pool);
  const containerManagerVersionReader = new ContainerManagerVersionReader(
    appConfig.CONTAINER_MANAGER_CONTROL_URL,
    appConfig.CONTAINER_MANAGER_CONTROL_TOKEN ?? null,
  );

  const logService = new LogService(pool);
  const logLevelCache = new LogLevelCache(pool, startupLogLevel);
  logService.setLevelFilter(logLevelCache);
  const logStreamService = new LogStreamService(pool);
  await runDatabaseListenerStartupWithRetry(() => logStreamService.start(), {
    logger: console,
    label: 'platform log stream listener',
  });

  const workerConnectionHub = new WorkerConnectionHub();
  const workerService = new WorkerService(pool, eventService, workerConnectionHub, appConfig);
  const taskService = new TaskService(pool, eventService, appConfig, workerConnectionHub, logService);
  const artifactStorage = createArtifactStorage(buildArtifactStorageConfig(appConfig));
  const workflowInputPacketService = new WorkflowInputPacketService(
    pool,
    artifactStorage,
    appConfig.WORKSPACE_ARTIFACT_MAX_UPLOAD_FILES,
    appConfig.WORKSPACE_ARTIFACT_MAX_UPLOAD_BYTES,
  );
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
    workflowInputPacketService,
  );
  const destructiveDeleteService = new DestructiveDeleteService(pool, {
    cancelWorkflow: workflowService.cancelWorkflow.bind(workflowService),
    cancelTask: taskService.cancelTask.bind(taskService),
    artifactStorage,
  });
  const workspaceService = new WorkspaceService(pool, eventService, appConfig, { destructiveDeleteService });
  const playbookService = new PlaybookService(pool, { destructiveDeleteService });
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
  const agenticSettingsService = new AgenticSettingsService(pool);
  const oauthService = new OAuthService(pool);
  const workflowDeliverableService = new WorkflowDeliverableService(pool);
  const workflowOperatorBriefService = new WorkflowOperatorBriefService(pool, workflowDeliverableService);
  const workflowOperatorUpdateService = new WorkflowOperatorUpdateService(pool);
  const workflowInterventionService = new WorkflowInterventionService(
    pool,
    artifactStorage,
    appConfig.WORKSPACE_ARTIFACT_MAX_UPLOAD_FILES,
    appConfig.WORKSPACE_ARTIFACT_MAX_UPLOAD_BYTES,
  );
  const workflowRedriveService = new WorkflowRedriveService(
    pool,
    workflowService,
    workflowInputPacketService,
    eventService,
  );
  const workflowSettingsService = new WorkflowSettingsService(pool);
  const workflowSteeringSessionService = new WorkflowSteeringSessionService(
    pool,
    workflowInterventionService,
  );
  const approvalQueueService = new ApprovalQueueService(pool);
  const workflowOperationsLiveService = new MissionControlLiveService(pool);
  const workflowOperationsRecentService = new MissionControlRecentService(pool, workflowOperationsLiveService);
  const workflowOperationsHistoryService = new MissionControlHistoryService(pool, workflowOperationsLiveService);
  const workflowOperationsRailService = new WorkflowRailService(
    workflowOperationsLiveService,
    workflowOperationsRecentService,
    workflowOperationsHistoryService,
  );
  const workflowOperationsHistoryPacketService = new WorkflowHistoryService(
    workflowOperationsHistoryService,
    workflowOperatorBriefService,
    workflowOperatorUpdateService,
    workflowInterventionService,
    workflowInputPacketService,
  );
  const workflowOperationsBriefsService = new WorkflowBriefsService(
    workflowOperationsHistoryService,
    workflowOperatorBriefService,
  );
  const workflowOperationsLiveConsoleService = new WorkflowLiveConsoleService(
    workflowOperationsHistoryService,
    workflowOperatorBriefService,
    workflowSettingsService,
    logService,
    workflowService,
    taskService,
  );
  const workflowDeliverableHandoffService = new WorkflowDeliverableHandoffService(pool);
  const workflowDeliverableLifecycleService = new WorkflowDeliverableLifecycleService(pool);
  const workflowOperationsDeliverablesService = new WorkflowDeliverablesService(
    workflowDeliverableService,
    workflowOperatorBriefService,
    workflowInputPacketService,
    workflowDeliverableHandoffService,
    workflowDeliverableLifecycleService,
    {
      listWorkflowDocuments: (tenantId: string, workflowId: string) =>
        listWorkflowDocuments(pool, tenantId, workflowId),
    },
  );
  const workflowOperationsWorkspaceService = new WorkflowWorkspaceService(
    workflowService,
    workflowOperationsRailService,
    workflowOperationsLiveConsoleService,
    workflowOperationsHistoryPacketService,
    workflowOperationsDeliverablesService,
    workflowInterventionService,
    workflowSteeringSessionService,
    taskService,
    approvalQueueService,
    workflowOperationsBriefsService,
  );
  const workflowOperationsStreamService = new WorkflowOperationsStreamService(
    workflowOperationsRailService,
    workflowOperationsWorkspaceService,
  );
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
  registerCommunityCatalogServices({
    app,
    config: appConfig,
    logService,
    playbookService,
    pool,
    roleDefinitionService,
    specialistSkillService,
  });
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
  app.decorate(
    'containerManagerVersionReader',
    createLoggedService(containerManagerVersionReader, 'ContainerManagerVersionReader', logService),
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
  app.decorate(
    'workflowInputPacketService',
    createLoggedService(workflowInputPacketService, 'WorkflowInputPacketService', logService),
  );
  app.decorate(
    'workflowOperatorBriefService',
    createLoggedService(workflowOperatorBriefService, 'WorkflowOperatorBriefService', logService),
  );
  app.decorate(
    'workflowOperatorUpdateService',
    createLoggedService(workflowOperatorUpdateService, 'WorkflowOperatorUpdateService', logService),
  );
  app.decorate(
    'workflowDeliverableService',
    createLoggedService(workflowDeliverableService, 'WorkflowDeliverableService', logService),
  );
  app.decorate(
    'workflowInterventionService',
    createLoggedService(workflowInterventionService, 'WorkflowInterventionService', logService),
  );
  app.decorate(
    'workflowRedriveService',
    createLoggedService(workflowRedriveService, 'WorkflowRedriveService', logService),
  );
  app.decorate(
    'workflowSettingsService',
    createLoggedService(workflowSettingsService, 'WorkflowSettingsService', logService),
  );
  app.decorate(
    'workflowSteeringSessionService',
    createLoggedService(workflowSteeringSessionService, 'WorkflowSteeringSessionService', logService),
  );
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
  app.decorate(
    'agenticSettingsService',
    createLoggedService(agenticSettingsService, 'AgenticSettingsService', logService),
  );
  app.decorate(
    'workflowOperationsLiveService',
    createLoggedService(workflowOperationsLiveService, 'MissionControlLiveService', logService),
  );
  app.decorate(
    'workflowOperationsRecentService',
    createLoggedService(workflowOperationsRecentService, 'MissionControlRecentService', logService),
  );
  app.decorate(
    'workflowOperationsHistoryService',
    createLoggedService(workflowOperationsHistoryService, 'MissionControlHistoryService', logService),
  );
  app.decorate(
    'workflowOperationsWorkspaceService',
    createLoggedService(workflowOperationsWorkspaceService, 'WorkflowWorkspaceService', logService),
  );
  app.decorate(
    'workflowOperationsRailService',
    createLoggedService(workflowOperationsRailService, 'WorkflowRailService', logService),
  );
  app.decorate(
    'workflowOperationsLiveConsoleService',
    createLoggedService(workflowOperationsLiveConsoleService, 'WorkflowLiveConsoleService', logService),
  );
  app.decorate(
    'workflowOperationsHistoryPacketService',
    createLoggedService(workflowOperationsHistoryPacketService, 'WorkflowHistoryService', logService),
  );
  app.decorate(
    'workflowOperationsDeliverablesService',
    createLoggedService(workflowOperationsDeliverablesService, 'WorkflowDeliverablesService', logService),
  );
  app.decorate(
    'workflowOperationsStreamService',
    createLoggedService(workflowOperationsStreamService, 'WorkflowOperationsStreamService', logService),
  );
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
