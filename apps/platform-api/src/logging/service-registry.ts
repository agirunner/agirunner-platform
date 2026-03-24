export interface ServiceLogConfig {
  entityType: string;
  category: 'config' | 'task_lifecycle' | 'auth' | 'container' | 'api';
  nameField: string;
  ignoreFields: string[];
  ignoreMethods: string[];
  logMethods?: string[];
  debugMethods?: string[];
}

export const SERVICE_REGISTRY: Record<string, ServiceLogConfig> = {
  WorkspaceService: {
    entityType: 'workspace',
    category: 'config',
    nameField: 'name',
    ignoreFields: ['updatedAt', 'createdAt', 'memory', 'memorySizeBytes'],
    ignoreMethods: [
      'getWorkspace',
      'listWorkspaces',
      'getGitWebhookSecret',
      'findWorkspaceByRepositoryUrl',
    ],
  },
  WorkspaceArtifactFileService: {
    entityType: 'workspace_artifact_file',
    category: 'config',
    nameField: 'file_name',
    ignoreFields: ['created_at', 'download_url', 'content_type', 'size_bytes'],
    ignoreMethods: ['listWorkspaceArtifactFiles', 'downloadWorkspaceArtifactFile'],
  },
  PlaybookService: {
    entityType: 'playbook',
    category: 'config',
    nameField: 'name',
    ignoreFields: ['updatedAt', 'createdAt', 'definition'],
    ignoreMethods: ['listPlaybooks', 'getPlaybook'],
  },
  WorkflowService: {
    entityType: 'workflow',
    category: 'task_lifecycle',
    nameField: 'name',
    ignoreFields: ['updatedAt', 'createdAt', 'context', 'contextSizeBytes'],
    ignoreMethods: ['getWorkflow', 'listWorkflows', 'getWorkflowDocuments', 'getResolvedConfig'],
    logMethods: ['advanceWorkflowStage', 'requestStageGateApproval'],
  },
  TaskService: {
    entityType: 'task',
    category: 'task_lifecycle',
    nameField: 'title',
    ignoreFields: ['updatedAt', 'createdAt', 'stateChangedAt', 'context'],
    ignoreMethods: ['getTask', 'listTasks', 'getTaskContext', 'getTaskGitActivity'],
    logMethods: [
      'requestTaskChanges',
      'respondToEscalation',
      'agentEscalate',
      'resolveEscalation',
      'overrideTaskOutput',
    ],
  },
  UserService: {
    entityType: 'user',
    category: 'auth',
    nameField: 'displayName',
    ignoreFields: ['updatedAt', 'createdAt', 'passwordHash', 'lastLoginAt'],
    ignoreMethods: ['getUserById', 'listUsers'],
    logMethods: ['findOrCreateFromSSO'],
  },
  ApiKeyService: {
    entityType: 'api_key',
    category: 'auth',
    nameField: 'label',
    ignoreFields: ['createdAt', 'keyHash'],
    ignoreMethods: ['listApiKeys'],
  },
  ModelCatalogService: {
    entityType: 'llm_config',
    category: 'config',
    nameField: 'name',
    ignoreFields: ['updatedAt', 'createdAt', 'apiKeySecretRef'],
    ignoreMethods: [
      'getProvider', 'listProviders', 'getModel', 'listModels',
      'listAssignments', 'resolveRoleConfig',
    ],
    logMethods: ['upsertAssignment', 'bulkCreateModels'],
  },
  OrchestratorConfigService: {
    entityType: 'orchestrator_config',
    category: 'config',
    nameField: 'id',
    ignoreFields: ['updatedAt'],
    ignoreMethods: ['get'],
  },
  RoleDefinitionService: {
    entityType: 'role',
    category: 'config',
    nameField: 'name',
    ignoreFields: ['updatedAt', 'createdAt'],
    ignoreMethods: ['getRoleById', 'getRoleByName', 'listRoles'],
  },
  RuntimeDefaultsService: {
    entityType: 'runtime_default',
    category: 'config',
    nameField: 'key',
    ignoreFields: ['updatedAt', 'createdAt'],
    ignoreMethods: ['getDefault', 'listDefaults'],
    logMethods: ['upsertDefault'],
  },
  FleetService: {
    entityType: 'infrastructure',
    category: 'container',
    nameField: 'name',
    ignoreFields: ['lastHeartbeatAt', 'createdAt'],
    ignoreMethods: [
      'listWorkers', 'getInfrastructureStatus', 'listInfrastructureEvents',
      'listContainers', 'listImages', 'getQueueDepth', 'getRuntimeTargets',
      'getFleetStatus', 'listHeartbeats', 'listFleetEvents',
      'getContainerStats', 'getWorker', 'validateRuntimeConfig',
    ],
    logMethods: ['requestImagePull'],
  },
  WorkerService: {
    entityType: 'worker',
    category: 'container',
    nameField: 'name',
    ignoreFields: ['updatedAt', 'createdAt', 'lastHeartbeatAt'],
    ignoreMethods: ['getWorker', 'listWorkers'],
    logMethods: ['sendSignal', 'acknowledgeSignal', 'acknowledgeTask'],
    debugMethods: ['sendSignal', 'acknowledgeSignal', 'acknowledgeTask'],
  },
  GovernanceService: {
    entityType: 'governance',
    category: 'config',
    nameField: 'id',
    ignoreFields: [],
    ignoreMethods: ['getRetentionPolicy'],
  },
  OAuthService: {
    entityType: 'oauth_connection',
    category: 'auth',
    nameField: 'profileId',
    ignoreFields: ['accessToken', 'refreshToken'],
    ignoreMethods: ['resolveValidToken', 'getStatus'],
    logMethods: ['initiateFlow', 'handleCallback'],
  },
  OrchestratorGrantService: {
    entityType: 'orchestrator_grant',
    category: 'auth',
    nameField: 'id',
    ignoreFields: [],
    ignoreMethods: ['listGrants', 'hasPermission', 'subtaskPermission'],
  },
  AcpSessionService: {
    entityType: 'acp_session',
    category: 'api',
    nameField: 'id',
    ignoreFields: [],
    ignoreMethods: ['getSession', 'normalizeOutput'],
  },
  ToolTagService: {
    entityType: 'tool_tag',
    category: 'config',
    nameField: 'name',
    ignoreFields: [],
    ignoreMethods: ['listToolTags'],
  },
  WorkflowActivationService: {
    entityType: 'workflow_activation',
    category: 'task_lifecycle',
    nameField: 'id',
    ignoreFields: ['payload', 'error', 'summary'],
    ignoreMethods: ['list', 'listWorkflowActivations', 'get', 'getWorkflowActivation'],
  },
  AgentService: {
    entityType: 'agent',
    category: 'api',
    nameField: 'name',
    ignoreFields: [],
    ignoreMethods: ['listAgents', 'enforceHeartbeatTimeouts'],
  },
};
