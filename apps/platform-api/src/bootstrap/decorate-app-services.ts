import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { createLoggedService } from '../logging/execution/create-logged-service.js';
import type { AppServices, PlatformAppConfig } from './app-services.js';

interface DecorateAppServicesInput {
  app: FastifyInstance;
  config: PlatformAppConfig;
  pool: Pool;
  services: AppServices;
}

export function decorateAppServices(input: DecorateAppServicesInput): void {
  const { app, config, pool, services } = input;

  app.decorate('config', config);
  app.decorate('pgPool', pool);
  app.decorate('logService', services.logService);
  app.decorate('logLevelCache', services.logLevelCache);
  app.decorate('logStreamService', services.logStreamService);
  app.decorate('eventService', services.eventService);
  app.decorate('eventStreamService', services.eventStreamService);
  app.decorate('workerConnectionHub', services.workerConnectionHub);

  decorateLoggedService(
    app,
    'containerInventoryService',
    services.containerInventoryService,
    'ContainerInventoryService',
    services,
  );
  decorateLoggedService(
    app,
    'containerManagerVersionReader',
    services.containerManagerVersionReader,
    'ContainerManagerVersionReader',
    services,
  );
  decorateLoggedService(app, 'workerService', services.workerService, 'WorkerService', services);
  decorateLoggedService(
    app,
    'governanceService',
    services.governanceService,
    'GovernanceService',
    services,
  );
  decorateLoggedService(
    app,
    'workspaceService',
    services.workspaceService,
    'WorkspaceService',
    services,
  );
  decorateLoggedService(
    app,
    'workspaceArtifactFileService',
    services.workspaceArtifactFileService,
    'WorkspaceArtifactFileService',
    services,
  );
  decorateLoggedService(
    app,
    'playbookService',
    services.playbookService,
    'PlaybookService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowService',
    services.workflowService,
    'WorkflowService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowActivationService',
    services.workflowActivationService,
    'WorkflowActivationService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowInputPacketService',
    services.workflowInputPacketService,
    'WorkflowInputPacketService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowOperatorBriefService',
    services.workflowOperatorBriefService,
    'WorkflowOperatorBriefService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowOperatorUpdateService',
    services.workflowOperatorUpdateService,
    'WorkflowOperatorUpdateService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowDeliverableService',
    services.workflowDeliverableService,
    'WorkflowDeliverableService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowInterventionService',
    services.workflowInterventionService,
    'WorkflowInterventionService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowRedriveService',
    services.workflowRedriveService,
    'WorkflowRedriveService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowSettingsService',
    services.workflowSettingsService,
    'WorkflowSettingsService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowSteeringSessionService',
    services.workflowSteeringSessionService,
    'WorkflowSteeringSessionService',
    services,
  );
  decorateLoggedService(app, 'taskService', services.taskService, 'TaskService', services);
  decorateLoggedService(app, 'userService', services.userService, 'UserService', services);
  decorateLoggedService(app, 'apiKeyService', services.apiKeyService, 'ApiKeyService', services);
  decorateLoggedService(
    app,
    'orchestratorConfigService',
    services.orchestratorConfigService,
    'OrchestratorConfigService',
    services,
  );
  decorateLoggedService(
    app,
    'roleDefinitionService',
    services.roleDefinitionService,
    'RoleDefinitionService',
    services,
  );
  decorateLoggedService(
    app,
    'runtimeDefaultsService',
    services.runtimeDefaultsService,
    'RuntimeDefaultsService',
    services,
  );
  decorateLoggedService(
    app,
    'executionEnvironmentCatalogService',
    services.executionEnvironmentCatalogService,
    'ExecutionEnvironmentCatalogService',
    services,
  );
  decorateLoggedService(
    app,
    'executionEnvironmentService',
    services.executionEnvironmentService,
    'ExecutionEnvironmentService',
    services,
  );
  decorateLoggedService(
    app,
    'executionEnvironmentVerificationService',
    services.executionEnvironmentVerificationService,
    'ExecutionEnvironmentVerificationService',
    services,
  );
  decorateLoggedService(app, 'fleetService', services.fleetService, 'FleetService', services);
  decorateLoggedService(
    app,
    'modelCatalogService',
    services.modelCatalogService,
    'ModelCatalogService',
    services,
  );
  decorateLoggedService(
    app,
    'agenticSettingsService',
    services.agenticSettingsService,
    'AgenticSettingsService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowOperationsLiveService',
    services.workflowOperationsLiveService,
    'MissionControlLiveService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowOperationsRecentService',
    services.workflowOperationsRecentService,
    'MissionControlRecentService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowOperationsHistoryService',
    services.workflowOperationsHistoryService,
    'MissionControlHistoryService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowOperationsWorkspaceService',
    services.workflowOperationsWorkspaceService,
    'WorkflowWorkspaceService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowOperationsRailService',
    services.workflowOperationsRailService,
    'WorkflowRailService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowOperationsLiveConsoleService',
    services.workflowOperationsLiveConsoleService,
    'WorkflowLiveConsoleService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowOperationsHistoryPacketService',
    services.workflowOperationsHistoryPacketService,
    'WorkflowHistoryService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowOperationsDeliverablesService',
    services.workflowOperationsDeliverablesService,
    'WorkflowDeliverablesService',
    services,
  );
  decorateLoggedService(
    app,
    'workflowOperationsStreamService',
    services.workflowOperationsStreamService,
    'WorkflowOperationsStreamService',
    services,
  );
  decorateLoggedService(app, 'oauthService', services.oauthService, 'OAuthService', services);
  decorateLoggedService(
    app,
    'remoteMcpOAuthClientProfileService',
    services.remoteMcpOAuthClientProfileService,
    'RemoteMcpOAuthClientProfileService',
    services,
  );
  decorateLoggedService(
    app,
    'remoteMcpServerService',
    services.remoteMcpServerService,
    'RemoteMcpServerService',
    services,
  );
  decorateLoggedService(
    app,
    'remoteMcpOAuthService',
    services.remoteMcpOAuthService,
    'RemoteMcpOAuthService',
    services,
  );
  decorateLoggedService(
    app,
    'remoteMcpVerificationService',
    services.remoteMcpVerificationService,
    'RemoteMcpVerificationService',
    services,
  );
  decorateLoggedService(
    app,
    'specialistSkillService',
    services.specialistSkillService,
    'SpecialistSkillService',
    services,
  );
  decorateLoggedService(
    app,
    'orchestratorGrantService',
    services.orchestratorGrantService,
    'OrchestratorGrantService',
    services,
  );
  decorateLoggedService(
    app,
    'acpSessionService',
    services.acpSessionService,
    'AcpSessionService',
    services,
  );
  decorateLoggedService(app, 'toolTagService', services.toolTagService, 'ToolTagService', services);
  decorateLoggedService(app, 'agentService', services.agentService, 'AgentService', services);
}

function decorateLoggedService<T extends object>(
  app: FastifyInstance,
  name: string,
  service: T,
  serviceName: string,
  services: AppServices,
): void {
  app.decorate(
    name as never,
    createLoggedService(service, serviceName, services.logService) as never,
  );
}
