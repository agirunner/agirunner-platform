import type pg from 'pg';

import type { ApiKeyIdentity } from './auth/api-key.js';
import type { AppEnv } from './config/schema.js';
import type { LogService } from './logging/log-service.js';
import type { LogStreamService } from './logging/log-stream-service.js';
import type { ApiKeyService } from './services/api-key-service.js';
import type { AuditService } from './services/audit-service.js';
import type { EventStreamService } from './services/event-stream-service.js';
import type { EventService } from './services/event-service.js';
import type { FleetService } from './services/fleet-service.js';
import type { GovernanceService } from './services/governance-service.js';
import type { IntegrationActionService } from './services/integration-action-service.js';
import type { IntegrationAdapterService } from './services/integration-adapter-service.js';
import type { ModelCatalogService } from './services/model-catalog-service.js';
import type { ProjectService } from './services/project-service.js';
import type { RoleDefinitionService } from './services/role-definition-service.js';
import type { RuntimeDefaultsService } from './services/runtime-defaults-service.js';
import type { TaskService } from './services/task-service.js';
import type { TemplateService } from './services/template-service.js';
import type { UserService } from './services/user-service.js';
import type { WebhookService } from './services/webhook-service.js';
import type { WorkerConnectionHub } from './services/worker-connection-hub.js';
import type { WorkerService } from './services/worker-service.js';
import type { WorkflowService } from './services/workflow-service.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppEnv;
    pgPool: pg.Pool;
    logService: LogService;
    logStreamService: LogStreamService;
    auditService: AuditService;
    eventService: EventService;
    eventStreamService: EventStreamService;
    integrationActionService: IntegrationActionService;
    integrationAdapterService: IntegrationAdapterService;
    workerConnectionHub: WorkerConnectionHub;
    workerService: WorkerService;
    webhookService: WebhookService;
    governanceService: GovernanceService;
    projectService: ProjectService;
    templateService: TemplateService;
    workflowService: WorkflowService;
    taskService: TaskService;
    userService: UserService;
    apiKeyService: ApiKeyService;
    roleDefinitionService: RoleDefinitionService;
    runtimeDefaultsService: RuntimeDefaultsService;
    fleetService: FleetService;
    modelCatalogService: ModelCatalogService;
  }

  interface FastifyRequest {
    auth?: ApiKeyIdentity;
    rawBody?: Buffer;
  }
}
