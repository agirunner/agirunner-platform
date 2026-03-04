import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import type { CreateTaskInput, TaskServiceConfig } from './task-service.types.js';

interface TaskWriteDependencies {
  pool: DatabasePool;
  eventService: EventService;
  config: TaskServiceConfig;
  loadTaskOrThrow: (tenantId: string, taskId: string) => Promise<Record<string, unknown>>;
  toTaskResponse: (task: Record<string, unknown>) => Record<string, unknown>;
}

export class TaskWriteService {
  constructor(private readonly deps: TaskWriteDependencies) {}

  async createTask(identity: ApiKeyIdentity, input: CreateTaskInput) {
    if (!input.title?.trim()) throw new ValidationError('title is required');

    const dependencies = input.depends_on ?? [];
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
      ...(input.metadata ?? {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.parent_id ? { parent_id: input.parent_id } : {}),
    };

    const insertResult = await this.deps.pool.query(
      `INSERT INTO tasks (
        tenant_id, pipeline_id, project_id, title, type, role, priority, state, depends_on,
        requires_approval, input, context, capabilities_required, role_config, environment,
        resource_bindings, timeout_minutes, token_budget, cost_cap_usd, auto_retry, max_retries, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[],$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      RETURNING *`,
      [
        identity.tenantId,
        input.pipeline_id ?? null,
        input.project_id ?? null,
        input.title,
        input.type,
        input.role ?? null,
        input.priority ?? 'normal',
        initialState,
        dependencies,
        input.requires_approval ?? false,
        input.input ?? {},
        input.context ?? {},
        input.capabilities_required ?? [],
        input.role_config ?? null,
        input.environment ?? null,
        input.resource_bindings ?? [],
        input.timeout_minutes ?? this.deps.config.TASK_DEFAULT_TIMEOUT_MINUTES,
        input.token_budget ?? null,
        input.cost_cap_usd ?? null,
        input.auto_retry ?? this.deps.config.TASK_DEFAULT_AUTO_RETRY,
        input.max_retries ?? this.deps.config.TASK_DEFAULT_MAX_RETRIES,
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
