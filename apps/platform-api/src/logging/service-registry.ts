export interface ServiceLogConfig {
  entityType: string;
  category: 'config' | 'task_lifecycle' | 'auth' | 'container' | 'api';
  nameField: string;
  ignoreFields: string[];
  ignoreMethods: string[];
}

export const SERVICE_REGISTRY: Record<string, ServiceLogConfig> = {
  ProjectService: {
    entityType: 'project',
    category: 'config',
    nameField: 'name',
    ignoreFields: ['updatedAt', 'createdAt', 'memory', 'memorySizeBytes'],
    ignoreMethods: [
      'getProject', 'listProjects', 'getProjectSpec', 'getProjectTimeline',
      'getProjectResources', 'getProjectTools',
    ],
  },
  WorkflowService: {
    entityType: 'workflow',
    category: 'task_lifecycle',
    nameField: 'name',
    ignoreFields: ['updatedAt', 'createdAt', 'context', 'contextSizeBytes'],
    ignoreMethods: ['getWorkflow', 'listWorkflows', 'getWorkflowDocuments', 'getResolvedConfig'],
  },
  TaskService: {
    entityType: 'task',
    category: 'task_lifecycle',
    nameField: 'title',
    ignoreFields: ['updatedAt', 'createdAt', 'stateChangedAt', 'context'],
    ignoreMethods: ['getTask', 'listTasks', 'getTaskContext', 'getTaskGitActivity'],
  },
  UserService: {
    entityType: 'user',
    category: 'auth',
    nameField: 'displayName',
    ignoreFields: ['updatedAt', 'createdAt', 'passwordHash', 'lastLoginAt'],
    ignoreMethods: ['getUserById', 'listUsers'],
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
  },
  WorkerService: {
    entityType: 'worker',
    category: 'container',
    nameField: 'name',
    ignoreFields: ['updatedAt', 'createdAt', 'lastHeartbeatAt'],
    ignoreMethods: ['getWorker', 'listWorkers'],
  },
  GovernanceService: {
    entityType: 'governance',
    category: 'config',
    nameField: 'id',
    ignoreFields: [],
    ignoreMethods: ['getRetentionPolicy'],
  },
  WebhookService: {
    entityType: 'webhook',
    category: 'config',
    nameField: 'url',
    ignoreFields: ['updatedAt', 'createdAt', 'secret'],
    ignoreMethods: ['listWebhooks'],
  },
  IntegrationAdapterService: {
    entityType: 'integration',
    category: 'config',
    nameField: 'name',
    ignoreFields: ['updatedAt', 'createdAt'],
    ignoreMethods: ['listAdapters'],
  },
  OAuthService: {
    entityType: 'oauth_connection',
    category: 'auth',
    nameField: 'profileId',
    ignoreFields: ['accessToken', 'refreshToken'],
    ignoreMethods: ['resolveValidToken', 'getStatus'],
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
  WebhookWorkItemTriggerService: {
    entityType: 'work_item_trigger',
    category: 'config',
    nameField: 'name',
    ignoreFields: ['secret'],
    ignoreMethods: ['listTriggers'],
  },
  AgentService: {
    entityType: 'agent',
    category: 'api',
    nameField: 'name',
    ignoreFields: [],
    ignoreMethods: ['listAgents', 'enforceHeartbeatTimeouts'],
  },
};
