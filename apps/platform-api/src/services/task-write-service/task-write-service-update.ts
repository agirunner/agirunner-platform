import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { ConflictError, NotFoundError } from '../../errors/domain-errors.js';
import { assertNoPlaintextSecrets } from './task-write-service.helpers.js';
import type { TaskWriteDependencies } from './task-write-service.types.js';

export class TaskWriteUpdateService {
  constructor(private readonly deps: TaskWriteDependencies) {}

  async updateTask(tenantId: string, taskId: string, payload: Record<string, unknown>) {
    if ('state' in payload)
      throw new ConflictError('Task state cannot be changed via PATCH /tasks/:id');
    assertNoPlaintextSecrets('task update payload', {
      metadata: payload.metadata,
    });
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
        metadata = $5,
        timeout_minutes = COALESCE($6, timeout_minutes),
        input = CASE WHEN $7::jsonb IS NULL THEN input ELSE jsonb_set(input, '{description}', to_jsonb($7::text), true) END
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [
        tenantId,
        taskId,
        (payload.title as string | undefined) ?? null,
        (payload.priority as string | undefined) ?? null,
        nextMetadata,
        (payload.timeout_minutes as number | undefined) ?? null,
        (payload.description as string | undefined) ?? null,
      ],
    );

    if (!result.rowCount) throw new NotFoundError('Task not found');
    return this.deps.toTaskResponse(result.rows[0] as Record<string, unknown>);
  }

  async updateTaskInput(
    tenantId: string,
    taskId: string,
    input: Record<string, unknown>,
    db: DatabaseClient | DatabasePool = this.deps.pool,
  ) {
    assertNoPlaintextSecrets('task input update payload', { input });
    const task = await this.deps.loadTaskOrThrow(tenantId, taskId);
    const currentState = String(task.state ?? '');
    if (currentState === 'completed' || currentState === 'cancelled') {
      throw new ConflictError('Terminal tasks cannot be edited');
    }

    const result = await db.query(
      `UPDATE tasks
          SET input = $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
        RETURNING *`,
      [tenantId, taskId, input],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Task not found');
    }

    const updatedTask = result.rows[0] as Record<string, unknown>;
    await this.deps.eventService.emit({
      tenantId,
      type: 'task.input_updated',
      entityType: 'task',
      entityId: taskId,
      actorType: 'agent',
      data: {
        workflow_id: updatedTask.workflow_id ?? null,
        work_item_id: updatedTask.work_item_id ?? null,
        stage_name: updatedTask.stage_name ?? null,
      },
    }, 'release' in db ? db : undefined);
    return this.deps.toTaskResponse(updatedTask);
  }
}
