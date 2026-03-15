import type { ApiKeyIdentity } from '../auth/api-key.js';
import { ArtifactService } from './artifact-service.js';
import { buildArtifactStorageConfig } from '../content/storage-config.js';
import { createArtifactStorage } from '../content/storage-factory.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ArtifactRetentionService } from './artifact-retention-service.js';
import { EventService } from './event-service.js';
import { ModelCatalogService } from './model-catalog-service.js';
import { TaskClaimService } from './task-claim-service.js';
import { TaskLifecycleService } from './task-lifecycle-service.js';
import { WorkflowStateService } from './workflow-state-service.js';
import { ProjectTimelineService } from './project-timeline-service.js';
import { TaskQueryService } from './task-query-service.js';
import { TaskTimeoutService } from './task-timeout-service.js';
import type { CreateTaskInput, ListTaskQuery, TaskServiceConfig } from './task-service.types.js';
import type { LogService } from '../logging/log-service.js';
import type { WorkerConnectionHub } from './worker-connection-hub.js';
import { TaskWriteService } from './task-write-service.js';
import { OrchestratorGrantService } from './orchestrator-grant-service.js';
import { RoleDefinitionService } from './role-definition-service.js';
import { PlaybookTaskParallelismService } from './playbook-task-parallelism-service.js';
import { WorkItemContinuityService } from './work-item-continuity-service.js';
import { WorkflowActivationDispatchService } from './workflow-activation-dispatch-service.js';
import { WorkflowBudgetService } from './workflow-budget-service.js';
const DEFAULT_CANCEL_SIGNAL_GRACE_PERIOD_MS = 60_000;
const DEFAULT_WORKFLOW_ACTIVATION_DELAY_MS = 10_000;
const DEFAULT_WORKFLOW_ACTIVATION_STALE_AFTER_MS = 300_000;
export class TaskService {
  private readonly queryService: TaskQueryService;
  private readonly writeService: TaskWriteService;
  private readonly lifecycleService: TaskLifecycleService;
  private readonly claimService: TaskClaimService;
  private readonly timeoutService: TaskTimeoutService;
  constructor(
    pool: DatabasePool,
    eventService: EventService,
    config: TaskServiceConfig,
    connectionHub?: WorkerConnectionHub,
    logService?: LogService,
  ) {
    const cancelSignalGracePeriodMs =
      config.TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS ?? DEFAULT_CANCEL_SIGNAL_GRACE_PERIOD_MS;
    const workflowActivationDelayMs =
      config.WORKFLOW_ACTIVATION_DELAY_MS ?? DEFAULT_WORKFLOW_ACTIVATION_DELAY_MS;
    const workflowActivationStaleAfterMs =
      config.WORKFLOW_ACTIVATION_STALE_AFTER_MS ?? DEFAULT_WORKFLOW_ACTIVATION_STALE_AFTER_MS;

    const queueWorkerCancelSignal = async (
      identity: ApiKeyIdentity,
      workerId: string,
      taskId: string,
      reason: 'manual_cancel' | 'task_timeout',
      requestedAt: Date,
    ): Promise<string | null> => {
      const workerExists = await pool.query(
        'SELECT id FROM workers WHERE tenant_id = $1 AND id = $2',
        [identity.tenantId, workerId],
      );
      if (!workerExists.rowCount) {
        return null;
      }

      const existingSignal = await pool.query<{ id: string }>(
        `SELECT id
         FROM worker_signals
         WHERE tenant_id = $1
           AND worker_id = $2
           AND task_id = $3
           AND signal_type = 'cancel_task'
           AND delivered = false
         ORDER BY created_at DESC
         LIMIT 1`,
        [identity.tenantId, workerId, taskId],
      );
      if (existingSignal.rowCount) {
        return existingSignal.rows[0].id;
      }

      const signalPayload = {
        reason,
        requested_at: requestedAt.toISOString(),
        grace_period_ms: cancelSignalGracePeriodMs,
      };

      const signalResult = await pool.query<{ id: string; created_at: Date }>(
        `INSERT INTO worker_signals (tenant_id, worker_id, signal_type, task_id, data)
         VALUES ($1, $2, 'cancel_task', $3, $4)
         RETURNING id, created_at`,
        [identity.tenantId, workerId, taskId, signalPayload],
      );

      const signal = signalResult.rows[0];
      connectionHub?.sendToWorker(workerId, {
        type: 'worker.signal',
        signal_id: signal.id,
        signal_type: 'cancel_task',
        task_id: taskId,
        data: signalPayload,
        issued_at: signal.created_at,
      });

      await eventService.emit({
        tenantId: identity.tenantId,
        type: 'worker.signaled',
        entityType: 'worker',
        entityId: workerId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: { signal_type: 'cancel_task', task_id: taskId },
      });

      return signal.id;
    };

    this.queryService = new TaskQueryService(pool);
    const orchestratorGrantService = new OrchestratorGrantService(pool, eventService);
    const parallelismService = new PlaybookTaskParallelismService(pool);
    const roleDefService = new RoleDefinitionService(pool);
    this.writeService = new TaskWriteService({
      pool,
      eventService,
      config,
      hasOrchestratorPermission: orchestratorGrantService.hasPermission.bind(orchestratorGrantService),
      subtaskPermission: orchestratorGrantService.subtaskPermission(),
      loadTaskOrThrow: this.queryService.loadTaskOrThrow.bind(this.queryService),
      toTaskResponse: this.queryService.toTaskResponse.bind(this.queryService),
      parallelismService,
      resolveRoleCapabilities: async (tenantId: string, roleName: string) => {
        const role = await roleDefService.getRoleByName(tenantId, roleName);
        return role?.capabilities ?? null;
      },
    });

    const artifactRetentionService = new ArtifactRetentionService(
      pool,
      createArtifactStorage(buildArtifactStorageConfig(config)),
    );
    const projectTimelineService = new ProjectTimelineService(pool);
    const artifactService = new ArtifactService(
      pool,
      createArtifactStorage(buildArtifactStorageConfig(config)),
      config.ARTIFACT_ACCESS_URL_TTL_SECONDS ?? 900,
    );
    const workflowStateService = new WorkflowStateService(
      pool,
      eventService,
      artifactRetentionService,
      projectTimelineService,
      logService,
    );
    const workflowBudgetService = new WorkflowBudgetService(
      pool,
      eventService,
      {
        WORKFLOW_BUDGET_WARNING_RATIO: config.WORKFLOW_BUDGET_WARNING_RATIO,
      },
    );
    const workflowActivationDispatchService = new WorkflowActivationDispatchService({
      pool,
      eventService,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: config.TASK_DEFAULT_TIMEOUT_MINUTES,
        WORKFLOW_ACTIVATION_DELAY_MS: workflowActivationDelayMs,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: workflowActivationStaleAfterMs,
      },
    });
    const workItemContinuityService = new WorkItemContinuityService(pool);
    this.lifecycleService = new TaskLifecycleService({
      pool,
      eventService,
      workflowStateService,
      defaultTaskTimeoutMinutes: config.TASK_DEFAULT_TIMEOUT_MINUTES,
      artifactService,
      loadTaskOrThrow: this.queryService.loadTaskOrThrow.bind(this.queryService),
      toTaskResponse: this.queryService.toTaskResponse.bind(this.queryService),
      queueWorkerCancelSignal,
      getRoleByName: async (tenantId: string, name: string) => {
        const role = await roleDefService.getRoleByName(tenantId, name);
        if (!role) return null;
        return {
          escalation_target: role.escalation_target,
          max_escalation_depth: role.max_escalation_depth,
        };
      },
      finalizeOrchestratorActivation:
        workflowActivationDispatchService.finalizeActivationForTask.bind(
          workflowActivationDispatchService,
        ),
      evaluateWorkflowBudget: async (tenantId, workflowId, client) => {
        await workflowBudgetService.evaluatePolicy(tenantId, workflowId, client);
      },
      parallelismService,
      workItemContinuityService,
    });

    const modelCatalog = new ModelCatalogService(pool);
    this.claimService = new TaskClaimService({
      pool,
      eventService,
      toTaskResponse: this.queryService.toTaskResponse.bind(this.queryService),
      getTaskContext: this.queryService.getTaskContext.bind(this.queryService),
      resolveRoleConfig: modelCatalog.resolveRoleConfig.bind(modelCatalog),
      parallelismService,
      claimHandleSecret: config.WEBHOOK_ENCRYPTION_KEY ?? '',
    });

    this.timeoutService = new TaskTimeoutService(
      pool,
      this.lifecycleService.applyStateTransition.bind(this.lifecycleService),
      queueWorkerCancelSignal,
      cancelSignalGracePeriodMs,
    );
  }

  createTask(identity: ApiKeyIdentity, input: CreateTaskInput, client?: DatabaseClient) {
    return this.writeService.createTask(identity, input, client);
  }

  listTasks(tenantId: string, query: ListTaskQuery) {
    return this.queryService.listTasks(tenantId, query);
  }
  getTask(tenantId: string, taskId: string) {
    return this.queryService.getTask(tenantId, taskId);
  }
  getTaskGitActivity(tenantId: string, taskId: string) {
    return this.queryService.getTaskGitActivity(tenantId, taskId);
  }
  updateTask(tenantId: string, taskId: string, payload: Record<string, unknown>) {
    return this.writeService.updateTask(tenantId, taskId, payload);
  }
  updateTaskInput(
    tenantId: string,
    taskId: string,
    input: Record<string, unknown>,
    client?: DatabaseClient,
  ) {
    return this.writeService.updateTaskInput(tenantId, taskId, input, client);
  }
  getTaskContext(tenantId: string, taskId: string, agentId?: string) {
    return this.queryService.getTaskContext(tenantId, taskId, agentId);
  }
  claimTask(
    identity: ApiKeyIdentity,
    payload: {
      agent_id: string;
      worker_id?: string;
      capabilities: string[];
      workflow_id?: string;
      playbook_id?: string;
      include_context?: boolean;
    },
  ) {
    return this.claimService.claimTask(identity, payload);
  }
  resolveClaimCredentials(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      llm_api_key_claim_handle?: string;
      llm_extra_headers_claim_handle?: string;
    },
  ) {
    return this.claimService.resolveClaimCredentials(identity, taskId, payload);
  }
  startTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { agent_id?: string; worker_id?: string },
  ) {
    return this.lifecycleService.startTask(identity, taskId, payload);
  }
  completeTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      output: unknown;
      metrics?: Record<string, unknown>;
      git_info?: Record<string, unknown>;
      verification?: Record<string, unknown>;
      agent_id?: string;
      worker_id?: string;
    },
  ) {
    return this.lifecycleService.completeTask(identity, taskId, payload);
  }

  failTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      error: Record<string, unknown>;
      metrics?: Record<string, unknown>;
      git_info?: Record<string, unknown>;
      agent_id?: string;
      worker_id?: string;
    },
  ) {
    return this.lifecycleService.failTask(identity, taskId, payload);
  }

  approveTask(identity: ApiKeyIdentity, taskId: string, client?: DatabaseClient) {
    return this.lifecycleService.approveTask(identity, taskId, client);
  }

  approveTaskOutput(identity: ApiKeyIdentity, taskId: string, client?: DatabaseClient) {
    return this.lifecycleService.approveTaskOutput(identity, taskId, client);
  }

  retryTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { override_input?: Record<string, unknown>; force?: boolean } = {},
    client?: DatabaseClient,
  ) {
    return this.lifecycleService.retryTask(identity, taskId, payload, client);
  }

  cancelTask(identity: ApiKeyIdentity, taskId: string, client?: DatabaseClient) {
    return this.lifecycleService.cancelTask(identity, taskId, client);
  }

  rejectTask(identity: ApiKeyIdentity, taskId: string, payload: { feedback: string }) {
    return this.lifecycleService.rejectTask(identity, taskId, payload);
  }

  requestTaskChanges(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      feedback: string;
      override_input?: Record<string, unknown>;
      preferred_agent_id?: string;
      preferred_worker_id?: string;
    },
    client?: DatabaseClient,
  ) {
    return this.lifecycleService.requestTaskChanges(identity, taskId, payload, client);
  }

  skipTask(identity: ApiKeyIdentity, taskId: string, payload: { reason: string }) {
    return this.lifecycleService.skipTask(identity, taskId, payload);
  }

  reassignTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { preferred_agent_id?: string; preferred_worker_id?: string; reason: string },
    client?: DatabaseClient,
  ) {
    return this.lifecycleService.reassignTask(identity, taskId, payload, client);
  }

  escalateTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      reason: string;
      escalation_target?: string;
      context?: Record<string, unknown>;
      recommendation?: string;
      blocking_task_id?: string;
      urgency?: 'info' | 'important' | 'critical';
    },
    client?: DatabaseClient,
  ) {
    return this.lifecycleService.escalateTask(identity, taskId, payload, client);
  }

  respondToEscalation(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { instructions: string; context?: Record<string, unknown> },
  ) {
    return this.lifecycleService.respondToEscalation(identity, taskId, payload);
  }

  agentEscalate(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { reason: string; context_summary?: string; work_so_far?: string },
  ) {
    return this.lifecycleService.agentEscalate(identity, taskId, payload);
  }

  resolveEscalation(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { instructions: string; context?: Record<string, unknown> },
  ) {
    return this.lifecycleService.resolveEscalation(identity, taskId, payload);
  }

  overrideTaskOutput(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { output: unknown; reason: string },
  ) {
    return this.lifecycleService.overrideTaskOutput(identity, taskId, payload);
  }

  failTimedOutTasks(now = new Date()) {
    return this.timeoutService.failTimedOutTasks(now);
  }

  finalizeGracefulWorkflowCancellations(now = new Date()) {
    return this.timeoutService.finalizeGracefulWorkflowCancellations(now);
  }
}
