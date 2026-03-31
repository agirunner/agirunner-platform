import { resolve } from 'node:path';

import fastify from 'fastify';

import type { AppEnv } from '../../../../src/config/schema.js';
import { DEFAULT_TENANT_ID } from '../../../../src/db/seed.js';
import { registerErrorHandler } from '../../../../src/errors/error-handler.js';
import { EventService } from '../../../../src/services/event/event-service.js';
import type { PlatformTransportTimingDefaults } from '../../../../src/services/platform-config/platform-timing-defaults.js';
import { PlaybookService } from '../../../../src/services/playbook/playbook-service.js';
import { RoleDefinitionService } from '../../../../src/services/role-definition/role-definition-service.js';
import { TaskService } from '../../../../src/services/task/task-service.js';
import { WorkerConnectionHub } from '../../../../src/services/workers/worker-connection-hub.js';
import { WorkerService } from '../../../../src/services/workers/worker-service.js';
import { WorkflowActivationDispatchService } from '../../../../src/services/workflow-activation-dispatch/workflow-activation-dispatch-service.js';
import { WorkflowActivationService } from '../../../../src/services/workflow-activation/workflow-activation-service.js';
import { WorkflowService } from '../../../../src/services/workflow-service/workflow-service.js';
import type { TestDatabase } from '../../db/postgres.js';

export const TEST_IDENTITY = {
  id: 'key-1',
  tenantId: DEFAULT_TENANT_ID,
  scope: 'admin' as const,
  ownerType: 'tenant' as const,
  ownerId: DEFAULT_TENANT_ID,
  keyPrefix: 'test-admin',
};

export const TEST_APP_CONFIG = {
  TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS: 60_000,
  WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
  WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
  ARTIFACT_STORAGE_BACKEND: 'local',
  ARTIFACT_LOCAL_ROOT: resolve('tmp/agirunner-platform-artifacts-test'),
  ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
  WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: 30,
  WORKER_WEBSOCKET_PATH: '/api/v1/events',
  WORKER_DISPATCH_ACK_TIMEOUT_MS: 15_000,
  WORKER_DISPATCH_BATCH_LIMIT: 20,
  EVENT_STREAM_KEEPALIVE_INTERVAL_MS: 15_000,
  WORKER_RECONNECT_MIN_MS: 1_000,
  WORKER_RECONNECT_MAX_MS: 60_000,
  WORKER_WEBSOCKET_PING_INTERVAL_MS: 20_000,
  LIFECYCLE_AGENT_HEARTBEAT_CHECK_INTERVAL_MS: 60_000,
  LIFECYCLE_WORKER_HEARTBEAT_CHECK_INTERVAL_MS: 60_000,
  LIFECYCLE_TASK_TIMEOUT_CHECK_INTERVAL_MS: 60_000,
  LIFECYCLE_DISPATCH_LOOP_INTERVAL_MS: 1_000,
  GOVERNANCE_RETENTION_JOB_INTERVAL_MS: 60_000,
} as const satisfies Partial<AppEnv & PlatformTransportTimingDefaults>;

export function createV2Harness(
  db: TestDatabase,
  configOverride: Partial<AppEnv & PlatformTransportTimingDefaults> = {},
) {
  const config = {
    ...TEST_APP_CONFIG,
    ...configOverride,
  } as const satisfies Partial<AppEnv & PlatformTransportTimingDefaults>;
  const logger = {
    info: () => undefined,
    error: () => undefined,
  };
  const connectionHub = new WorkerConnectionHub();
  const eventService = new EventService(db.pool);
  const playbookService = new PlaybookService(db.pool);
  const workflowService = new WorkflowService(db.pool, eventService, config as never);
  const taskService = new TaskService(db.pool, eventService, config as never);
  const roleDefinitionService = new RoleDefinitionService(db.pool);
  const workerService = new WorkerService(
    db.pool,
    eventService,
    connectionHub,
    config as never,
  );
  const workflowActivationService = new WorkflowActivationService(db.pool, eventService);
  const workflowActivationDispatchService = new WorkflowActivationDispatchService({
    pool: db.pool,
    eventService,
    config,
  });

  return {
    logger,
    config,
    connectionHub,
    eventService,
    playbookService,
    workflowService,
    taskService,
    roleDefinitionService,
    workerService,
    workflowActivationService,
    workflowActivationDispatchService,
  };
}

export async function createOrchestratorControlTestApp(
  db: TestDatabase,
  harness: ReturnType<typeof createV2Harness>,
) {
  const { orchestratorControlRoutes } = await import('../../../../src/api/routes/orchestrator-control/routes.js');
  const app = fastify();
  registerErrorHandler(app);
  app.decorate('pgPool', db.pool as never);
  app.decorate('config', harness.config as never);
  app.decorate('eventService', harness.eventService as never);
  app.decorate('workflowService', harness.workflowService as never);
  app.decorate('taskService', harness.taskService as never);
  await app.register(orchestratorControlRoutes);
  return app;
}

export function agentIdentity(agentId: string) {
  return {
    id: `agent-key:${agentId}`,
    tenantId: DEFAULT_TENANT_ID,
    scope: 'agent' as const,
    ownerType: 'agent' as const,
    ownerId: agentId,
    keyPrefix: `agent-${agentId}`,
  };
}

export function workerIdentity(workerId: string) {
  return {
    id: `worker-key:${workerId}`,
    tenantId: DEFAULT_TENANT_ID,
    scope: 'worker' as const,
    ownerType: 'worker' as const,
    ownerId: workerId,
    keyPrefix: `worker-${workerId}`,
  };
}
