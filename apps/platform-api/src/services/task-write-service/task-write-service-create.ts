import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/domain-errors.js';
import { logSafetynetTriggered } from '../safetynet/logging.js';
import {
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
  mustGetSafetynetEntry,
} from '../safetynet/registry.js';
import { TaskWriteCreateDefaults } from './task-write-service-create-defaults.js';
import { TaskWriteCreateGuards } from './task-write-service-create-guards.js';
import { TaskWriteParentPolicies } from './task-write-service-create-parent.js';
import { readTemplateLifecyclePolicy } from '../task-lifecycle/task-lifecycle-policy.js';
import {
  assertMatchingCreateTaskReplay,
  assertNoPlaintextSecrets,
  buildExpectedCreateTaskIntent,
  buildExpectedCreateTaskReplay,
  normalizeTaskContractInput,
  resolveTaskExecutionBackend,
  selectPersistedSubjectLinkage,
  stripRedactedTaskSecretPlaceholders,
} from './task-write-service.helpers.js';
import type { CreateTaskInput } from '../task-service.types.js';
import type { TaskWriteDependencies } from './task-write-service.types.js';

const IDEMPOTENT_MUTATION_REPLAY_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
);

export class TaskWriteCreateService {
  private readonly guards: TaskWriteCreateGuards;
  private readonly defaults: TaskWriteCreateDefaults;
  private readonly parents: TaskWriteParentPolicies;

  constructor(private readonly deps: TaskWriteDependencies) {
    this.guards = new TaskWriteCreateGuards(deps);
    this.defaults = new TaskWriteCreateDefaults(deps);
    this.parents = new TaskWriteParentPolicies(deps);
  }

  async createTask(
    identity: ApiKeyIdentity,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool = this.deps.pool,
  ) {
    if (!input.title?.trim()) throw new ValidationError('title is required');
    assertNoPlaintextSecrets('task create payload', {
      credentials: input.credentials,
      input: input.input,
      context: input.context,
      role_config: input.role_config,
      environment: input.environment,
      resource_bindings: input.resource_bindings,
      metadata: input.metadata,
    });
    let normalizedInput = stripRedactedTaskSecretPlaceholders(input);
    normalizedInput = normalizedInput.parent_id
      ? await this.applyParentTaskPolicies(identity, normalizedInput)
      : normalizedInput;
    normalizedInput = await this.applyLinkedWorkItemDefaults(identity.tenantId, normalizedInput, db);
    this.assertWorkflowTaskLinkage(normalizedInput);
    if (!normalizedInput.work_item_id) {
      await this.assertWorkflowAcceptsTaskMutation(identity.tenantId, normalizedInput.workflow_id ?? null, db);
    }
    await this.assertLinkedWorkItem(identity.tenantId, normalizedInput, db);
    normalizedInput = await this.applyWorkflowExecutionDefaults(identity.tenantId, normalizedInput, db);
    normalizedInput = await this.applyPlaybookTaskExecutionDefaults(identity.tenantId, normalizedInput, db);
    normalizedInput = await this.materializeTaskLoopExecutionDefaults(identity.tenantId, normalizedInput, db);
    normalizedInput = await this.applyPlaybookRuleDerivedTaskReviewPolicy(identity.tenantId, normalizedInput, db);
    normalizedInput = normalizeTaskContractInput(normalizedInput);
    const executionBackend = resolveTaskExecutionBackend(normalizedInput);
    const dependencies = normalizedInput.depends_on ?? [];
    const metadata = {
      ...(normalizedInput.metadata ?? {}),
      ...(normalizedInput.branch_id ? { branch_id: normalizedInput.branch_id } : {}),
      ...selectPersistedSubjectLinkage(normalizedInput),
      ...(normalizedInput.retry_policy
        ? { lifecycle_policy: { retry_policy: readTemplateLifecyclePolicy({ retry_policy: normalizedInput.retry_policy }, 'retry_policy')?.retry_policy } }
        : {}),
      ...(normalizedInput.description ? { description: normalizedInput.description } : {}),
      ...(normalizedInput.type ? { task_type: normalizedInput.type } : {}),
      ...(normalizedInput.task_kind ? { task_kind: normalizedInput.task_kind } : {}),
      ...(normalizedInput.credentials ? { credential_refs: normalizedInput.credentials } : {}),
      ...(normalizedInput.parent_id ? { parent_id: normalizedInput.parent_id } : {}),
      ...(normalizedInput.assessment_prompt
        ? { assessment_prompt: normalizedInput.assessment_prompt }
        : {}),
    };
    if (normalizedInput.request_id?.trim()) {
      const existing = await this.findExistingByRequestId(
        identity.tenantId,
        normalizedInput.request_id,
        normalizedInput.workflow_id ?? null,
        db,
      );
      if (existing) {
        assertMatchingCreateTaskReplay(
          existing,
          buildExpectedCreateTaskReplay(
            normalizedInput,
            dependencies,
            metadata,
          ),
        );
        logSafetynetTriggered(
          IDEMPOTENT_MUTATION_REPLAY_SAFETYNET,
          'idempotent task create replay returned stored task',
          {
            workflow_id: normalizedInput.workflow_id ?? null,
            work_item_id: normalizedInput.work_item_id ?? null,
            request_id: normalizedInput.request_id.trim(),
          },
        );
        return this.deps.toTaskResponse(existing);
      }
    }

    if (dependencies.length > 0) {
      const check = await db.query(
        'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [identity.tenantId, dependencies],
      );
      if (check.rowCount !== dependencies.length)
        throw new NotFoundError('One or more dependency tasks were not found');
    }

    const existingReusableTask = await this.findExistingReusableTaskForWorkItemRole(
      identity.tenantId,
      normalizedInput,
      dependencies,
      metadata,
      db,
    );
    if (existingReusableTask) {
      return this.deps.toTaskResponse(existingReusableTask);
    }

    const hasUnfinishedDependencies = await this.hasUnfinishedDependencies(identity.tenantId, dependencies, db);
    const initialState = await this.resolveInitialState(identity.tenantId, normalizedInput, hasUnfinishedDependencies);
    const timeoutMinutes = await this.resolveTimeoutMinutes(identity.tenantId, normalizedInput, db);

    const insertResult = await db.query(
      `INSERT INTO tasks (
        tenant_id, workflow_id, work_item_id, workspace_id, title, role, stage_name, priority, state, depends_on,
        input, context, role_config, environment,
        resource_bindings, activation_id, request_id, is_orchestrator_task, timeout_minutes, token_budget, cost_cap_usd, auto_retry, max_retries, max_iterations, llm_max_retries, branch_id, execution_backend, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
      ON CONFLICT DO NOTHING
      RETURNING *`,
      [
        identity.tenantId,
        normalizedInput.workflow_id ?? null,
        normalizedInput.work_item_id ?? null,
        normalizedInput.workspace_id ?? null,
        normalizedInput.title,
        normalizedInput.role ?? null,
        normalizedInput.stage_name ?? null,
        normalizedInput.priority ?? 'normal',
        initialState,
        dependencies,
        normalizedInput.input ?? {},
        normalizedInput.context ?? {},
        normalizedInput.role_config ?? null,
        normalizedInput.environment ?? null,
        JSON.stringify(normalizedInput.resource_bindings ?? []),
        normalizedInput.activation_id ?? null,
        normalizedInput.request_id?.trim() ?? null,
        normalizedInput.is_orchestrator_task ?? false,
        timeoutMinutes,
        normalizedInput.token_budget ?? null,
        normalizedInput.cost_cap_usd ?? null,
        normalizedInput.auto_retry ?? false,
        normalizedInput.max_retries ?? 0,
        normalizedInput.max_iterations ?? null,
        normalizedInput.llm_max_retries ?? null,
        normalizedInput.branch_id ?? null,
        executionBackend,
        metadata,
      ],
    );
    if (!insertResult.rowCount) {
      const replayRequestId = normalizedInput.request_id?.trim();
      const existing = replayRequestId
        ? await this.findExistingByRequestId(
            identity.tenantId,
            replayRequestId,
            normalizedInput.workflow_id ?? null,
            db,
          )
        : null;
      if (existing) {
        assertMatchingCreateTaskReplay(
          existing,
          buildExpectedCreateTaskReplay(
            normalizedInput,
            dependencies,
            metadata,
          ),
        );
        logSafetynetTriggered(
          IDEMPOTENT_MUTATION_REPLAY_SAFETYNET,
          'idempotent task create replay returned stored task after insert conflict',
          {
            workflow_id: normalizedInput.workflow_id ?? null,
            work_item_id: normalizedInput.work_item_id ?? null,
            request_id: replayRequestId,
          },
        );
        return this.deps.toTaskResponse(existing);
      }
      throw new ConflictError('Task request conflicted but the existing task could not be loaded');
    }

    const task = insertResult.rows[0] as Record<string, unknown>;
    await this.deps.eventService.emit({
      tenantId: identity.tenantId,
      type: 'task.created',
      entityType: 'task',
      entityId: task.id as string,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { state: initialState },
    }, 'release' in db ? db : undefined);

    return this.deps.toTaskResponse(task);
  }


  private async assertWorkflowAcceptsTaskMutation(
    tenantId: string,
    workflowId: string | null,
    db: DatabaseClient | DatabasePool,
  ) {
    return (this.guards as any).assertWorkflowAcceptsTaskMutation(tenantId, workflowId, db);
  }

  private async resolveTimeoutMinutes(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ): Promise<number> {
    return (this.guards as any).resolveTimeoutMinutes(tenantId, input, db);
  }

  private async findExistingReusableTaskForWorkItemRole(
    tenantId: string,
    input: CreateTaskInput,
    dependencies: string[],
    metadata: Record<string, unknown>,
    db: DatabaseClient | DatabasePool,
  ) {
    return (this.guards as any).findExistingReusableTaskForWorkItemRole(
      tenantId,
      input,
      dependencies,
      metadata,
      db,
    );
  }

  private async findExistingByRequestId(
    tenantId: string,
    requestId: string,
    workflowId: string | null,
    db: DatabaseClient | DatabasePool,
  ) {
    return (this.guards as any).findExistingByRequestId(tenantId, requestId, workflowId, db);
  }

  private async assertLinkedWorkItem(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ) {
    return (this.guards as any).assertLinkedWorkItem(tenantId, input, db);
  }

  private async assertPlannedStageRoleMembership(
    tenantId: string,
    input: CreateTaskInput,
    linkedWorkItem: Record<string, unknown>,
    db: DatabaseClient | DatabasePool,
  ) {
    return (this.guards as any).assertPlannedStageRoleMembership(tenantId, input, linkedWorkItem, db);
  }

  private async applyParentTaskPolicies(identity: ApiKeyIdentity, input: CreateTaskInput) {
    return (this.parents as any).applyParentTaskPolicies(identity, input);
  }

  private async applyLinkedWorkItemDefaults(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ): Promise<CreateTaskInput> {
    return (this.defaults as any).applyLinkedWorkItemDefaults(tenantId, input, db);
  }

  private assertWorkflowTaskLinkage(input: CreateTaskInput) {
    return (this.defaults as any).assertWorkflowTaskLinkage(input);
  }

  private async applyWorkflowExecutionDefaults(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ): Promise<CreateTaskInput> {
    return (this.defaults as any).applyWorkflowExecutionDefaults(tenantId, input, db);
  }

  private async applyPlaybookRuleDerivedTaskReviewPolicy(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ): Promise<CreateTaskInput> {
    return (this.defaults as any).applyPlaybookRuleDerivedTaskReviewPolicy(tenantId, input, db);
  }

  private async applyPlaybookTaskExecutionDefaults(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ): Promise<CreateTaskInput> {
    return (this.defaults as any).applyPlaybookTaskExecutionDefaults(tenantId, input, db);
  }

  private async materializeTaskLoopExecutionDefaults(
    tenantId: string,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool,
  ): Promise<CreateTaskInput> {
    return (this.defaults as any).materializeTaskLoopExecutionDefaults(tenantId, input, db);
  }

  private async assertLinkedWorkItemAcceptsTaskMutation(linkedWorkItem: Record<string, unknown>) {
    return (this.defaults as any).assertLinkedWorkItemAcceptsTaskMutation(linkedWorkItem);
  }

  private async resolveInitialState(
    tenantId: string,
    input: CreateTaskInput,
    hasUnfinishedDependencies: boolean,
  ) {
    return (this.parents as any).resolveInitialState(tenantId, input, hasUnfinishedDependencies);
  }

  private async hasUnfinishedDependencies(
    tenantId: string,
    dependencies: string[],
    db: DatabaseClient | DatabasePool,
  ): Promise<boolean> {
    return (this.parents as any).hasUnfinishedDependencies(tenantId, dependencies, db);
  }
}
