import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import type { AppEnv } from '../config/schema.js';
import type { GovernanceService } from '../services/governance-service.js';
import type { PlatformTransportTimingDefaults } from '../services/platform-config/platform-timing-defaults.js';
import { buildArtifactStorageConfig } from '../content/storage-config.js';
import { createArtifactStorage } from '../content/storage-factory.js';
import { runDatabaseListenerStartupWithRetry } from '../db/startup-resilience.js';
import { listWorkflowDocuments } from '../services/document-reference/document-reference-service.js';
import { AcpSessionService } from '../services/acp-session-service.js';
import { AgentService } from '../services/agent-service.js';
import { ApprovalQueueService } from '../services/approval-queue-service/approval-queue-service.js';
import { ApiKeyService } from '../services/api-key-service.js';
import { DestructiveDeleteService } from '../services/destructive-delete/destructive-delete-service.js';
import { EventStreamService } from '../services/event/event-stream-service.js';
import { EventService } from '../services/event/event-service.js';
import { ExecutionEnvironmentCatalogService } from '../services/execution-environment/catalog-service.js';
import { ContainerManagerExecutionEnvironmentVerifier } from '../services/execution-environment/container-manager-verifier.js';
import { ContainerInventoryService } from '../services/execution-environment/container-inventory-service.js';
import { ExecutionEnvironmentService } from '../services/execution-environment/service.js';
import { ExecutionEnvironmentVerificationService } from '../services/execution-environment/verification-service.js';
import { FleetService } from '../services/fleet-service/fleet-service.js';
import { LogLevelCache } from '../logging/execution/log-level-cache.js';
import { LogService } from '../logging/execution/log-service.js';
import { LogStreamService } from '../logging/execution/log-stream-service.js';
import { applyDefaultTenantLoggingLevel } from '../logging/execution/platform-log-level.js';
import { ModelCatalogService } from '../services/model-catalog/model-catalog-service.js';
import { OAuthService } from '../services/oauth/oauth-service.js';
import { OrchestratorConfigService } from '../services/orchestrator/orchestrator-config-service.js';
import { OrchestratorGrantService } from '../services/orchestrator/orchestrator-grant-service.js';
import { PlaybookService } from '../services/playbook/playbook-service.js';
import { AgenticSettingsService } from '../services/platform-config/agentic-settings-service.js';
import { RemoteMcpOAuthClientProfileService } from '../services/remote-mcp/oauth/remote-mcp-oauth-client-profile-service.js';
import { RemoteMcpOAuthService } from '../services/remote-mcp/oauth/remote-mcp-oauth-service.js';
import { RemoteMcpServerService } from '../services/remote-mcp/servers/remote-mcp-server-service.js';
import { RemoteMcpHttpVerifier } from '../services/remote-mcp/verification/remote-mcp-http-verifier.js';
import { RemoteMcpVerificationService } from '../services/remote-mcp/verification/remote-mcp-verification-service.js';
import { RoleDefinitionService } from '../services/role-definition/role-definition-service.js';
import { RuntimeDefaultsService } from '../services/runtime-defaults/runtime-defaults-service.js';
import { SpecialistSkillService } from '../services/specialist/specialist-skill-service.js';
import { ContainerManagerVersionReader } from '../services/system-version/container-manager-version-reader.js';
import { TaskService } from '../services/task/task-service.js';
import { WorkflowActivationDispatchService } from '../services/workflow-activation-dispatch/workflow-activation-dispatch-service.js';
import { WorkflowActivationService } from '../services/workflow-activation/workflow-activation-service.js';
import { WorkflowDeliverableHandoffService } from '../services/workflow-deliverables/workflow-deliverable-handoff-service.js';
import { WorkflowDeliverableLifecycleService } from '../services/workflow-deliverables/workflow-deliverable-lifecycle-service.js';
import { WorkflowDeliverableService } from '../services/workflow-deliverables/workflow-deliverable-service.js';
import { WorkflowBriefsService } from '../services/workflow-operations/workflow-briefs-service.js';
import { WorkflowDeliverablesService } from '../services/workflow-operations/workflow-deliverables-service.js';
import { WorkflowHistoryService } from '../services/workflow-operations/workflow-history-service.js';
import { WorkflowInputPacketService } from '../services/workflow-operations/workflow-input-packet-service.js';
import { WorkflowInterventionService } from '../services/workflow-operations/workflow-intervention-service.js';
import { WorkflowLiveConsoleService } from '../services/workflow-operations/workflow-live-console-service.js';
import { MissionControlHistoryService } from '../services/workflow-operations/mission-control/history-service.js';
import { MissionControlLiveService } from '../services/workflow-operations/mission-control/live-service.js';
import { MissionControlRecentService } from '../services/workflow-operations/mission-control/recent-service.js';
import { WorkflowOperationsStreamService } from '../services/workflow-operations/workflow-operations-stream-service.js';
import { WorkflowRailService } from '../services/workflow-operations/workflow-rail-service.js';
import { WorkflowSettingsService } from '../services/workflow-operations/workflow-settings-service.js';
import { WorkflowWorkspaceService } from '../services/workflow-operations/workflow-workspace-service.js';
import { WorkflowOperatorBriefService } from '../services/workflow-operator/workflow-operator-brief-service.js';
import { WorkflowOperatorUpdateService } from '../services/workflow-operator/workflow-operator-update-service.js';
import { WorkflowRedriveService } from '../services/workflow-service/workflow-redrive-service.js';
import { WorkflowService } from '../services/workflow-service/workflow-service.js';
import { WorkflowSteeringSessionService } from '../services/workflow-steering-session-service/workflow-steering-session-service.js';
import { ToolTagService } from '../services/tool-tag-service.js';
import { UserService } from '../services/user-service.js';
import { WorkerConnectionHub } from '../services/workers/worker-connection-hub.js';
import { WorkerService } from '../services/workers/worker-service.js';
import { WorkspaceArtifactFileService } from '../services/workspace/artifacts/workspace-artifact-file-service.js';
import { WorkspaceService } from '../services/workspace/workspace-service.js';

export type PlatformAppConfig = AppEnv & PlatformTransportTimingDefaults;

interface BuildAppServicesInput {
  app: FastifyInstance;
  config: PlatformAppConfig;
  governanceService: GovernanceService;
  pool: Pool;
  startupLogLevel: string;
}

export async function buildAppServices(input: BuildAppServicesInput) {
  const eventService = new EventService(input.pool);
  const eventStreamService = new EventStreamService(input.pool);
  await runDatabaseListenerStartupWithRetry(() => eventStreamService.start(), {
    logger: console,
    label: 'platform event stream listener',
  });

  const containerInventoryService = new ContainerInventoryService(input.pool);
  const containerManagerVersionReader = new ContainerManagerVersionReader(
    input.config.CONTAINER_MANAGER_CONTROL_URL,
    input.config.CONTAINER_MANAGER_CONTROL_TOKEN ?? null,
  );

  const logService = new LogService(input.pool);
  const logLevelCache = new LogLevelCache(input.pool, input.startupLogLevel);
  logService.setLevelFilter(logLevelCache);

  const logStreamService = new LogStreamService(input.pool);
  await runDatabaseListenerStartupWithRetry(() => logStreamService.start(), {
    logger: console,
    label: 'platform log stream listener',
  });

  const workerConnectionHub = new WorkerConnectionHub();
  const workerService = new WorkerService(
    input.pool,
    eventService,
    workerConnectionHub,
    input.config,
  );
  const taskService = new TaskService(
    input.pool,
    eventService,
    input.config,
    workerConnectionHub,
    logService,
  );
  const artifactStorage = createArtifactStorage(buildArtifactStorageConfig(input.config));
  const workflowInputPacketService = new WorkflowInputPacketService(
    input.pool,
    artifactStorage,
    input.config.WORKSPACE_ARTIFACT_MAX_UPLOAD_FILES,
    input.config.WORKSPACE_ARTIFACT_MAX_UPLOAD_BYTES,
  );

  await applyDefaultTenantLoggingLevel({
    governanceService: input.governanceService,
    logger: input.app.log,
  });

  const workspaceArtifactFileService = new WorkspaceArtifactFileService(
    input.pool,
    artifactStorage,
    input.config.WORKSPACE_ARTIFACT_MAX_UPLOAD_FILES,
    input.config.WORKSPACE_ARTIFACT_MAX_UPLOAD_BYTES,
  );
  const workflowService = new WorkflowService(
    input.pool,
    eventService,
    input.config,
    workerConnectionHub,
    logService,
    taskService,
    workflowInputPacketService,
  );
  const destructiveDeleteService = new DestructiveDeleteService(input.pool, {
    cancelWorkflow: workflowService.cancelWorkflow.bind(workflowService),
    cancelTask: taskService.cancelTask.bind(taskService),
    artifactStorage,
  });
  const workspaceService = new WorkspaceService(input.pool, eventService, input.config, {
    destructiveDeleteService,
  });
  const playbookService = new PlaybookService(input.pool, { destructiveDeleteService });
  const workflowActivationService = new WorkflowActivationService(input.pool, eventService);
  const workflowActivationDispatchService = new WorkflowActivationDispatchService({
    pool: input.pool,
    eventService,
    config: input.config,
  });
  const userService = new UserService(input.pool);
  const apiKeyService = new ApiKeyService(input.pool);
  const orchestratorConfigService = new OrchestratorConfigService(input.pool);
  const roleDefinitionService = new RoleDefinitionService(input.pool);
  const fleetService = new FleetService(input.pool);
  const runtimeDefaultsService = new RuntimeDefaultsService(input.pool, fleetService, eventService);
  const executionEnvironmentCatalogService = new ExecutionEnvironmentCatalogService(input.pool);
  const executionEnvironmentService = new ExecutionEnvironmentService(
    input.pool,
    executionEnvironmentCatalogService,
  );
  const executionEnvironmentVerifier = new ContainerManagerExecutionEnvironmentVerifier(
    input.config.CONTAINER_MANAGER_CONTROL_URL,
    input.config.CONTAINER_MANAGER_CONTROL_TOKEN ?? null,
  );
  const executionEnvironmentVerificationService = new ExecutionEnvironmentVerificationService(
    input.pool,
    executionEnvironmentService,
    executionEnvironmentVerifier,
  );
  const modelCatalogService = new ModelCatalogService(input.pool);
  const agenticSettingsService = new AgenticSettingsService(input.pool);
  const oauthService = new OAuthService(input.pool);
  const workflowDeliverableService = new WorkflowDeliverableService(input.pool);
  const workflowOperatorBriefService = new WorkflowOperatorBriefService(
    input.pool,
    workflowDeliverableService,
  );
  const workflowOperatorUpdateService = new WorkflowOperatorUpdateService(input.pool);
  const workflowInterventionService = new WorkflowInterventionService(
    input.pool,
    artifactStorage,
    input.config.WORKSPACE_ARTIFACT_MAX_UPLOAD_FILES,
    input.config.WORKSPACE_ARTIFACT_MAX_UPLOAD_BYTES,
  );
  const workflowRedriveService = new WorkflowRedriveService(
    input.pool,
    workflowService,
    workflowInputPacketService,
    eventService,
  );
  const workflowSettingsService = new WorkflowSettingsService(input.pool);
  const workflowSteeringSessionService = new WorkflowSteeringSessionService(
    input.pool,
    workflowInterventionService,
  );
  const approvalQueueService = new ApprovalQueueService(input.pool);
  const workflowOperationsLiveService = new MissionControlLiveService(input.pool);
  const workflowOperationsRecentService = new MissionControlRecentService(
    input.pool,
    workflowOperationsLiveService,
  );
  const workflowOperationsHistoryService = new MissionControlHistoryService(
    input.pool,
    workflowOperationsLiveService,
  );
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
  const workflowDeliverableHandoffService = new WorkflowDeliverableHandoffService(input.pool);
  const workflowDeliverableLifecycleService = new WorkflowDeliverableLifecycleService(input.pool);
  const workflowOperationsDeliverablesService = new WorkflowDeliverablesService(
    workflowDeliverableService,
    workflowOperatorBriefService,
    workflowInputPacketService,
    workflowDeliverableHandoffService,
    workflowDeliverableLifecycleService,
    {
      listWorkflowDocuments: (tenantId: string, workflowId: string) =>
        listWorkflowDocuments(input.pool, tenantId, workflowId),
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
  const remoteMcpOAuthClientProfileService = new RemoteMcpOAuthClientProfileService(input.pool);
  const remoteMcpServerService = new RemoteMcpServerService(input.pool);
  const remoteMcpVerifier = new RemoteMcpHttpVerifier();
  const remoteMcpOAuthService = new RemoteMcpOAuthService(
    input.pool,
    remoteMcpServerService,
    remoteMcpVerifier,
    {
      platformPublicBaseUrl: input.config.PLATFORM_PUBLIC_BASE_URL,
      remoteMcpHostedCallbackBaseUrl: input.config.REMOTE_MCP_HOSTED_CALLBACK_BASE_URL,
    },
    remoteMcpOAuthClientProfileService,
  );
  const remoteMcpVerificationService = new RemoteMcpVerificationService(
    remoteMcpServerService,
    remoteMcpVerifier,
    remoteMcpOAuthService,
  );
  const specialistSkillService = new SpecialistSkillService(input.pool);
  const orchestratorGrantService = new OrchestratorGrantService(input.pool, eventService);
  const toolTagService = new ToolTagService(input.pool);
  const agentService = new AgentService(input.pool, eventService);
  const acpSessionService = new AcpSessionService(input.pool, eventService);

  return {
    governanceService: input.governanceService,
    eventService,
    eventStreamService,
    containerInventoryService,
    containerManagerVersionReader,
    logService,
    logLevelCache,
    logStreamService,
    workerConnectionHub,
    workerService,
    taskService,
    workflowInputPacketService,
    workspaceArtifactFileService,
    workflowService,
    workspaceService,
    playbookService,
    workflowActivationService,
    workflowActivationDispatchService,
    userService,
    apiKeyService,
    orchestratorConfigService,
    roleDefinitionService,
    fleetService,
    runtimeDefaultsService,
    executionEnvironmentCatalogService,
    executionEnvironmentService,
    executionEnvironmentVerificationService,
    modelCatalogService,
    agenticSettingsService,
    oauthService,
    workflowDeliverableService,
    workflowOperatorBriefService,
    workflowOperatorUpdateService,
    workflowInterventionService,
    workflowRedriveService,
    workflowSettingsService,
    workflowSteeringSessionService,
    workflowOperationsLiveService,
    workflowOperationsRecentService,
    workflowOperationsHistoryService,
    workflowOperationsRailService,
    workflowOperationsHistoryPacketService,
    workflowOperationsLiveConsoleService,
    workflowOperationsDeliverablesService,
    workflowOperationsWorkspaceService,
    workflowOperationsStreamService,
    remoteMcpOAuthClientProfileService,
    remoteMcpServerService,
    remoteMcpOAuthService,
    remoteMcpVerificationService,
    specialistSkillService,
    orchestratorGrantService,
    toolTagService,
    agentService,
    acpSessionService,
  };
}

export type AppServices = Awaited<ReturnType<typeof buildAppServices>>;
