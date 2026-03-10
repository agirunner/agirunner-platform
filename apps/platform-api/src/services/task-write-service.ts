import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import { readTemplateLifecyclePolicy } from './task-lifecycle-policy.js';
import type { CreateTaskInput, TaskServiceConfig } from './task-service.types.js';

interface TaskWriteDependencies {
  pool: DatabasePool;
  eventService: EventService;
  config: TaskServiceConfig;
  hasOrchestratorPermission: (
    tenantId: string,
    agentId: string,
    workflowId: string,
    permission: string,
  ) => Promise<boolean>;
  subtaskPermission: string;
  loadTaskOrThrow: (tenantId: string, taskId: string) => Promise<Record<string, unknown>>;
  toTaskResponse: (task: Record<string, unknown>) => Record<string, unknown>;
}

interface ParentTaskRow {
  id: string;
  workflow_id: string | null;
  project_id: string | null;
  assigned_agent_id: string | null;
  assigned_worker_id: string | null;
  parent_id: string | null;
}

const DEFAULT_MAX_SUBTASK_DEPTH = 3;
const DEFAULT_MAX_SUBTASKS_PER_PARENT = 20;

export class TaskWriteService {
  constructor(private readonly deps: TaskWriteDependencies) {}

  async createTask(identity: ApiKeyIdentity, input: CreateTaskInput) {
    if (!input.title?.trim()) throw new ValidationError('title is required');

    const normalizedInput = input.parent_id
      ? await this.applyParentTaskPolicies(identity, input)
      : input;

    const dependencies = normalizedInput.depends_on ?? [];
    if (dependencies.length > 0) {
      const check = await this.deps.pool.query(
        'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [identity.tenantId, dependencies],
      );
      if (check.rowCount !== dependencies.length)
        throw new NotFoundError('One or more dependency tasks were not found');
    }

    const initialState =
      dependencies.length > 0 ? 'pending' : input.requires_approval ? 'awaiting_approval' : 'ready';
    const metadata = {
      ...(normalizedInput.metadata ?? {}),
      ...(normalizedInput.retry_policy
        ? { lifecycle_policy: { retry_policy: readTemplateLifecyclePolicy({ retry_policy: normalizedInput.retry_policy }, 'retry_policy')?.retry_policy } }
        : {}),
      ...(normalizedInput.description ? { description: normalizedInput.description } : {}),
      ...(normalizedInput.parent_id ? { parent_id: normalizedInput.parent_id } : {}),
    };

    const insertResult = await this.deps.pool.query(
      `INSERT INTO tasks (
        tenant_id, workflow_id, project_id, title, role, priority, state, depends_on,
        requires_approval, input, context, capabilities_required, role_config, environment,
        resource_bindings, timeout_minutes, token_budget, cost_cap_usd, auto_retry, max_retries, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid[],$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING *`,
      [
        identity.tenantId,
        normalizedInput.workflow_id ?? null,
        normalizedInput.project_id ?? null,
        normalizedInput.title,
        normalizedInput.role ?? null,
        normalizedInput.priority ?? 'normal',
        initialState,
        dependencies,
        normalizedInput.requires_approval ?? false,
        normalizedInput.input ?? {},
        normalizedInput.context ?? {},
        normalizedInput.capabilities_required ?? [],
        normalizedInput.role_config ?? null,
        normalizedInput.environment ?? null,
        JSON.stringify(normalizedInput.resource_bindings ?? []),
        normalizedInput.timeout_minutes ?? this.deps.config.TASK_DEFAULT_TIMEOUT_MINUTES,
        normalizedInput.token_budget ?? null,
        normalizedInput.cost_cap_usd ?? null,
        normalizedInput.auto_retry ?? this.deps.config.TASK_DEFAULT_AUTO_RETRY,
        normalizedInput.max_retries ?? this.deps.config.TASK_DEFAULT_MAX_RETRIES,
        metadata,
      ],
    );

    const task = insertResult.rows[0] as Record<string, unknown>;
    await this.deps.eventService.emit({
      tenantId: identity.tenantId,
      type: 'task.created',
      entityType: 'task',
      entityId: task.id as string,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { state: initialState },
    });

    return this.deps.toTaskResponse(task);
  }

  private async applyParentTaskPolicies(identity: ApiKeyIdentity, input: CreateTaskInput) {
    const parentTask = await this.loadParentTask(identity.tenantId, input.parent_id as string);
    await this.assertSubtaskDepth(identity.tenantId, parentTask);
    await this.assertSubtaskCount(identity.tenantId, parentTask.id);
    await this.assertParentPermission(identity, parentTask);

    return {
      ...input,
      workflow_id: input.workflow_id ?? parentTask.workflow_id ?? undefined,
      project_id: input.project_id ?? parentTask.project_id ?? undefined,
    };
  }

  private async loadParentTask(tenantId: string, parentId: string): Promise<ParentTaskRow> {
    const result = await this.deps.pool.query<ParentTaskRow>(
      `SELECT id, workflow_id, project_id, assigned_agent_id, assigned_worker_id, metadata->>'parent_id' AS parent_id
         FROM tasks
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, parentId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Parent task not found');
    }
    return result.rows[0];
  }

  private async assertSubtaskDepth(tenantId: string, parentTask: ParentTaskRow) {
    const maxDepth = this.deps.config.TASK_MAX_SUBTASK_DEPTH ?? DEFAULT_MAX_SUBTASK_DEPTH;
    let depth = 1;
    let currentParentId = parentTask.parent_id;

    while (currentParentId) {
      depth += 1;
      if (depth >= maxDepth) {
        throw new ValidationError(`Sub-task depth limit of ${maxDepth} would be exceeded`);
      }

      const result = await this.deps.pool.query<{ parent_id: string | null }>(
        `SELECT metadata->>'parent_id' AS parent_id
           FROM tasks
          WHERE tenant_id = $1
            AND id = $2`,
        [tenantId, currentParentId],
      );
      if (!result.rowCount) {
        break;
      }
      currentParentId = result.rows[0].parent_id;
    }
  }

  private async assertSubtaskCount(tenantId: string, parentId: string) {
    const result = await this.deps.pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM tasks
        WHERE tenant_id = $1
          AND metadata->>'parent_id' = $2`,
      [tenantId, parentId],
    );
    const count = Number(result.rows[0]?.total ?? '0');
    const maxSubtasks =
      this.deps.config.TASK_MAX_SUBTASKS_PER_PARENT ?? DEFAULT_MAX_SUBTASKS_PER_PARENT;
    if (count >= maxSubtasks) {
      throw new ValidationError(
        `Sub-task count limit of ${maxSubtasks} would be exceeded`,
      );
    }
  }

  private async assertParentPermission(identity: ApiKeyIdentity, parentTask: ParentTaskRow) {
    if (identity.scope === 'admin') {
      return;
    }

    if (identity.scope === 'agent' && identity.ownerId === parentTask.assigned_agent_id) {
      return;
    }

    if (identity.scope === 'worker' && identity.ownerId === parentTask.assigned_worker_id) {
      return;
    }

    if (
      identity.scope === 'agent' &&
      identity.ownerId &&
      parentTask.workflow_id &&
      (await this.deps.hasOrchestratorPermission(
        identity.tenantId,
        identity.ownerId,
        parentTask.workflow_id,
        this.deps.subtaskPermission,
      ))
    ) {
      return;
    }

    throw new ForbiddenError('Only the assigned parent owner or an active orchestrator grant can create sub-tasks');
  }

  async updateTask(tenantId: string, taskId: string, payload: Record<string, unknown>) {
    if ('state' in payload)
      throw new ConflictError('Task state cannot be changed via PATCH /tasks/:id');
    const task = await this.deps.loadTaskOrThrow(tenantId, taskId);

    const nextMetadata = {
      ...((task.metadata ?? {}) as Record<string, unknown>),
      ...(typeof payload.description === 'string' ? { description: payload.description } : {}),
      ...(typeof payload.parent_id === 'string' ? { parent_id: payload.parent_id } : {}),
      ...(payload.metadata && typeof payload.metadata === 'object'
        ? (payload.metadata as Record<string, unknown>)
        : {}),
    };

    const result = await this.deps.pool.query(
      `UPDATE tasks SET title = COALESCE($3, title), priority = COALESCE($4::task_priority, priority),
        capabilities_required = COALESCE($5::text[], capabilities_required), metadata = $6,
        timeout_minutes = COALESCE($7, timeout_minutes),
        input = CASE WHEN $8::jsonb IS NULL THEN input ELSE jsonb_set(input, '{description}', to_jsonb($8::text), true) END
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [
        tenantId,
        taskId,
        (payload.title as string | undefined) ?? null,
        (payload.priority as string | undefined) ?? null,
        (payload.capabilities_required as string[] | undefined) ?? null,
        nextMetadata,
        (payload.timeout_minutes as number | undefined) ?? null,
        (payload.description as string | undefined) ?? null,
      ],
    );

    if (!result.rowCount) throw new NotFoundError('Task not found');
    return this.deps.toTaskResponse(result.rows[0] as Record<string, unknown>);
  }
}
