import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { EventService } from './event-service.js';
import { TaskClaimService } from './task-claim-service.js';
import { TaskLifecycleService } from './task-lifecycle-service.js';
import { PipelineStateService } from './pipeline-state-service.js';
import { TaskQueryService } from './task-query-service.js';
import { TaskTimeoutService } from './task-timeout-service.js';
import type { CreateTaskInput, ListTaskQuery, TaskServiceConfig } from './task-service.types.js';
import { TaskWriteService } from './task-write-service.js';

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
  ) {
    this.queryService = new TaskQueryService(pool);
    this.writeService = new TaskWriteService({
      pool,
      eventService,
      config,
      loadTaskOrThrow: this.queryService.loadTaskOrThrow.bind(this.queryService),
      toTaskResponse: this.queryService.toTaskResponse.bind(this.queryService),
    });

    const pipelineStateService = new PipelineStateService(pool, eventService);
    this.lifecycleService = new TaskLifecycleService({
      pool,
      eventService,
      pipelineStateService,
      loadTaskOrThrow: this.queryService.loadTaskOrThrow.bind(this.queryService),
      toTaskResponse: this.queryService.toTaskResponse.bind(this.queryService),
    });

    this.claimService = new TaskClaimService({
      pool,
      eventService,
      toTaskResponse: this.queryService.toTaskResponse.bind(this.queryService),
      getTaskContext: this.queryService.getTaskContext.bind(this.queryService),
    });

    this.timeoutService = new TaskTimeoutService(pool, this.lifecycleService.applyStateTransition.bind(this.lifecycleService));
  }

  createTask(identity: ApiKeyIdentity, input: CreateTaskInput) {
    return this.writeService.createTask(identity, input);
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

  getTaskContext(tenantId: string, taskId: string, agentId?: string) {
    return this.queryService.getTaskContext(tenantId, taskId, agentId);
  }

  claimTask(identity: ApiKeyIdentity, payload: { agent_id: string; worker_id?: string; capabilities: string[]; pipeline_id?: string; include_context?: boolean }) {
    return this.claimService.claimTask(identity, payload);
  }

  startTask(identity: ApiKeyIdentity, taskId: string, payload: { agent_id?: string; worker_id?: string }) {
    return this.lifecycleService.startTask(identity, taskId, payload);
  }

  completeTask(identity: ApiKeyIdentity, taskId: string, payload: { output: unknown }) {
    return this.lifecycleService.completeTask(identity, taskId, payload);
  }

  failTask(identity: ApiKeyIdentity, taskId: string, payload: { error: Record<string, unknown> }) {
    return this.lifecycleService.failTask(identity, taskId, payload);
  }

  approveTask(identity: ApiKeyIdentity, taskId: string) {
    return this.lifecycleService.approveTask(identity, taskId);
  }

  retryTask(identity: ApiKeyIdentity, taskId: string) {
    return this.lifecycleService.retryTask(identity, taskId);
  }

  cancelTask(identity: ApiKeyIdentity, taskId: string) {
    return this.lifecycleService.cancelTask(identity, taskId);
  }

  failTimedOutTasks(now = new Date()) {
    return this.timeoutService.failTimedOutTasks(now);
  }
}
