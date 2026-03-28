export interface ServiceLogConfig {
  entityType: string;
  category: 'config' | 'task_lifecycle' | 'auth' | 'container' | 'api';
  nameField: string;
  ignoreFields: string[];
  ignoreMethods: string[];
  logMethods?: string[];
  debugMethods?: string[];
}

type ServiceLogCategory = ServiceLogConfig['category'];

interface ServiceLogOptions {
  ignoreFields?: string[];
  ignoreMethods?: string[];
  logMethods?: string[];
  debugMethods?: string[];
}

function defineService(
  entityType: string,
  category: ServiceLogCategory,
  nameField: string,
  options: ServiceLogOptions = {},
): ServiceLogConfig {
  const config: ServiceLogConfig = {
    entityType,
    category,
    nameField,
    ignoreFields: options.ignoreFields ?? [],
    ignoreMethods: options.ignoreMethods ?? [],
  };

  if (options.logMethods) {
    config.logMethods = options.logMethods;
  }
  if (options.debugMethods) {
    config.debugMethods = options.debugMethods;
  }

  return config;
}

export const SERVICE_REGISTRY: Record<string, ServiceLogConfig> = {
  AcpSessionService: defineService('acp_session', 'api', 'id', {
    ignoreMethods: ['getSession', 'normalizeOutput'],
  }),
  AgentService: defineService('agent', 'api', 'name', {
    ignoreMethods: ['listAgents', 'enforceHeartbeatTimeouts'],
  }),
  AgenticSettingsService: defineService('agentic_settings', 'config', 'scope', {
    ignoreMethods: ['getSettings'],
  }),
  ApiKeyService: defineService('api_key', 'auth', 'label', {
    ignoreFields: ['createdAt', 'keyHash'],
    ignoreMethods: ['listApiKeys'],
  }),
  ContainerInventoryService: defineService('container_inventory', 'container', 'id', {
    ignoreMethods: ['listCurrentContainers'],
  }),
  ExecutionEnvironmentCatalogService: defineService('execution_environment_catalog', 'config', 'name', {
    ignoreMethods: ['listCatalog', 'getCatalogEntry'],
  }),
  ExecutionEnvironmentService: defineService('execution_environment', 'config', 'name', {
    ignoreMethods: ['listEnvironments', 'getEnvironment', 'resolveTaskExecutionEnvironment'],
  }),
  ExecutionEnvironmentVerificationService: defineService(
    'execution_environment',
    'container',
    'name',
    {
      ignoreMethods: ['listVerificationHistory', 'getLatestVerification'],
      logMethods: ['verifyEnvironment'],
    },
  ),
  FleetService: defineService('infrastructure', 'container', 'name', {
    ignoreFields: ['lastHeartbeatAt', 'createdAt'],
    ignoreMethods: [
      'listWorkers',
      'getInfrastructureStatus',
      'listInfrastructureEvents',
      'listContainers',
      'listImages',
      'getQueueDepth',
      'getRuntimeTargets',
      'getFleetStatus',
      'listHeartbeats',
      'listFleetEvents',
      'getContainerStats',
      'getWorker',
      'validateRuntimeConfig',
    ],
    logMethods: ['requestImagePull'],
  }),
  GovernanceService: defineService('governance', 'config', 'id', {
    ignoreMethods: ['getRetentionPolicy'],
  }),
  MissionControlHistoryService: defineService('mission_control_history', 'api', 'workflow_id', {
    ignoreMethods: ['getHistory'],
  }),
  MissionControlLiveService: defineService('mission_control_live', 'api', 'workflow_id', {
    ignoreMethods: ['getLive', 'listWorkflowCards', 'listWorkflowOutputDescriptors', 'getLatestEventId'],
  }),
  MissionControlRecentService: defineService('mission_control_recent', 'api', 'workflow_id', {
    ignoreMethods: ['getRecent'],
  }),
  ModelCatalogService: defineService('llm_config', 'config', 'name', {
    ignoreFields: ['updatedAt', 'createdAt', 'apiKeySecretRef'],
    ignoreMethods: ['getProvider', 'listProviders', 'getModel', 'listModels', 'listAssignments', 'resolveRoleConfig'],
    logMethods: ['upsertAssignment', 'bulkCreateModels'],
  }),
  OAuthService: defineService('oauth_connection', 'auth', 'profileId', {
    ignoreFields: ['accessToken', 'refreshToken'],
    ignoreMethods: ['resolveValidToken', 'getStatus'],
    logMethods: ['initiateFlow', 'handleCallback'],
  }),
  OrchestratorConfigService: defineService('orchestrator_config', 'config', 'id', {
    ignoreFields: ['updatedAt'],
    ignoreMethods: ['get'],
  }),
  OrchestratorGrantService: defineService('orchestrator_grant', 'auth', 'id', {
    ignoreMethods: ['listGrants', 'hasPermission', 'subtaskPermission'],
  }),
  PlaybookService: defineService('playbook', 'config', 'name', {
    ignoreFields: ['updatedAt', 'createdAt', 'definition'],
    ignoreMethods: ['listPlaybooks', 'getPlaybook'],
  }),
  RemoteMcpOAuthClientProfileService: defineService(
    'remote_mcp_oauth_client_profile',
    'auth',
    'name',
    {
      ignoreMethods: ['listProfiles', 'getProfile', 'getStoredProfile'],
    },
  ),
  RemoteMcpOAuthService: defineService('remote_mcp_oauth_connection', 'auth', 'serverId', {
    ignoreFields: ['authorizeUrl'],
    ignoreMethods: ['resolveStoredAuthorizationSecret'],
  }),
  RemoteMcpServerService: defineService('remote_mcp_server', 'config', 'name', {
    ignoreFields: [
      'created_at',
      'updated_at',
      'parameters',
      'discovered_tools_snapshot',
      'discovered_resources_snapshot',
      'discovered_prompts_snapshot',
      'verified_capability_summary',
    ],
    ignoreMethods: ['listServers', 'getServer', 'getStoredServer'],
  }),
  RemoteMcpVerificationService: defineService('remote_mcp_server', 'config', 'name', {
    logMethods: ['reverifyServer'],
  }),
  RoleDefinitionService: defineService('role', 'config', 'name', {
    ignoreFields: ['updatedAt', 'createdAt'],
    ignoreMethods: ['getRoleById', 'getRoleByName', 'listRoles'],
  }),
  RuntimeDefaultsService: defineService('runtime_default', 'config', 'key', {
    ignoreFields: ['updatedAt', 'createdAt'],
    ignoreMethods: ['getDefault', 'listDefaults'],
    logMethods: ['upsertDefault'],
  }),
  SpecialistSkillService: defineService('specialist_skill', 'config', 'name', {
    ignoreFields: ['created_at', 'updated_at', 'content'],
    ignoreMethods: ['listSkills', 'getSkill'],
  }),
  TaskService: defineService('task', 'task_lifecycle', 'title', {
    ignoreFields: ['updatedAt', 'createdAt', 'stateChangedAt', 'context'],
    ignoreMethods: ['getTask', 'listTasks', 'getTaskContext', 'getTaskGitActivity'],
    logMethods: ['requestTaskChanges', 'respondToEscalation', 'agentEscalate', 'resolveEscalation', 'overrideTaskOutput'],
  }),
  ToolTagService: defineService('tool_tag', 'config', 'name', {
    ignoreMethods: ['listToolTags'],
  }),
  UserService: defineService('user', 'auth', 'displayName', {
    ignoreFields: ['updatedAt', 'createdAt', 'passwordHash', 'lastLoginAt'],
    ignoreMethods: ['getUserById', 'listUsers'],
    logMethods: ['findOrCreateFromSSO'],
  }),
  WorkerService: defineService('worker', 'container', 'name', {
    ignoreFields: ['updatedAt', 'createdAt', 'lastHeartbeatAt'],
    ignoreMethods: ['getWorker', 'listWorkers'],
    logMethods: ['sendSignal', 'acknowledgeSignal', 'acknowledgeTask'],
    debugMethods: ['sendSignal', 'acknowledgeSignal', 'acknowledgeTask'],
  }),
  WorkflowActivationService: defineService('workflow_activation', 'task_lifecycle', 'id', {
    ignoreFields: ['payload', 'error', 'summary'],
    ignoreMethods: ['list', 'listWorkflowActivations', 'get', 'getWorkflowActivation'],
  }),
  WorkflowDeliverableService: defineService('workflow_deliverable', 'task_lifecycle', 'title', {
    ignoreMethods: ['listDeliverables'],
  }),
  WorkflowDeliverablesService: defineService('workflow_deliverables', 'api', 'workflow_id', {
    ignoreMethods: ['getDeliverables'],
  }),
  WorkflowHistoryService: defineService('workflow_history', 'api', 'workflow_id', {
    ignoreMethods: ['getHistory'],
  }),
  WorkflowInputPacketService: defineService('workflow_input_packet', 'task_lifecycle', 'packet_kind', {
    ignoreMethods: ['listWorkflowInputPackets', 'downloadWorkflowInputPacketFile'],
  }),
  WorkflowInterventionService: defineService('workflow_intervention', 'task_lifecycle', 'summary', {
    ignoreMethods: ['listWorkflowInterventions', 'downloadWorkflowInterventionFile'],
    logMethods: ['recordIntervention'],
  }),
  WorkflowLiveConsoleService: defineService('workflow_live_console', 'api', 'workflow_id', {
    ignoreMethods: ['getLiveConsole'],
  }),
  WorkflowOperationsStreamService: defineService('workflow_operations_stream', 'api', 'workspace_id', {
    ignoreMethods: ['buildRailBatch', 'buildWorkspaceBatch'],
  }),
  WorkflowOperatorBriefService: defineService(
    'workflow_operator_brief',
    'task_lifecycle',
    'brief_kind',
    {
      ignoreMethods: ['listBriefs'],
      logMethods: ['recordBrief'],
    },
  ),
  WorkflowOperatorUpdateService: defineService(
    'workflow_operator_update',
    'task_lifecycle',
    'headline',
    {
      ignoreMethods: ['listUpdates', 'readWorkflowLiveVisibilityModeOverride'],
      logMethods: ['recordUpdate'],
    },
  ),
  WorkflowRailService: defineService('workflow_rail', 'api', 'workflow_id', {
    ignoreMethods: ['getRail', 'getWorkflowCard'],
  }),
  WorkflowRedriveService: defineService('workflow_redrive', 'task_lifecycle', 'source_workflow_id', {
    logMethods: ['redriveWorkflow'],
  }),
  WorkflowService: defineService('workflow', 'task_lifecycle', 'name', {
    ignoreFields: ['updatedAt', 'createdAt', 'context', 'contextSizeBytes'],
    ignoreMethods: ['getWorkflow', 'listWorkflows', 'getWorkflowDocuments', 'getResolvedConfig'],
    logMethods: ['advanceWorkflowStage', 'requestStageGateApproval'],
  }),
  WorkflowSettingsService: defineService('workflow_settings', 'config', 'workflow_id', {
    ignoreMethods: ['getWorkflowSettings'],
  }),
  WorkflowSteeringSessionService: defineService('workflow_steering_session', 'task_lifecycle', 'title', {
    ignoreMethods: ['listSessions', 'listMessages'],
    logMethods: ['appendMessage', 'recordSteeringRequest'],
  }),
  WorkflowWorkspaceService: defineService('workflow_workspace', 'api', 'workspace_id', {
    ignoreMethods: ['getWorkspace'],
  }),
  WorkspaceArtifactFileService: defineService('workspace_artifact_file', 'config', 'file_name', {
    ignoreFields: ['created_at', 'download_url', 'content_type', 'size_bytes'],
    ignoreMethods: ['listWorkspaceArtifactFiles', 'downloadWorkspaceArtifactFile'],
  }),
  WorkspaceService: defineService('workspace', 'config', 'name', {
    ignoreFields: ['updatedAt', 'createdAt', 'memory', 'memorySizeBytes'],
    ignoreMethods: ['getWorkspace', 'listWorkspaces', 'getGitWebhookSecret', 'findWorkspaceByRepositoryUrl'],
  }),
};
