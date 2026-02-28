import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { buildTaskContext } from './task-context-service.js';
import type { ListTaskQuery } from './task-service.types.js';

export class TaskQueryService {
  constructor(private readonly pool: DatabasePool) {}

  async loadTaskOrThrow(tenantId: string, taskId: string, client?: DatabaseClient) {
    const db = client ?? this.pool;
    const result = await db.query('SELECT * FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskId]);
    if (!result.rowCount) throw new NotFoundError('Task not found');
    return result.rows[0] as Record<string, unknown>;
  }

  toTaskResponse(task: Record<string, unknown>) {
    const metadata = (task.metadata ?? {}) as Record<string, unknown>;
    return { ...task, description: metadata.description ?? null, parent_id: metadata.parent_id ?? null };
  }

  async listTasks(tenantId: string, query: ListTaskQuery) {
    const where: string[] = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];

    const arrayFilters: Array<[string | undefined, string]> = [
      [query.state, 'state = ANY($%s::task_state[])'],
      [query.type, 'type = ANY($%s::task_type[])'],
    ];
    for (const [filter, template] of arrayFilters) {
      if (!filter) continue;
      values.push(filter.split(','));
      where.push(template.replace('%s', String(values.length)));
    }

    const exactFilters: Array<[string | undefined, string]> = [
      [query.project_id, 'project_id'],
      [query.assigned_agent_id, 'assigned_agent_id'],
      [query.pipeline_id, 'pipeline_id'],
      [query.parent_id, "metadata->>'parent_id'"],
    ];
    for (const [filter, column] of exactFilters) {
      if (!filter) continue;
      values.push(filter);
      where.push(`${column} = $${values.length}`);
    }

    const offset = (query.page - 1) * query.per_page;
    values.push(query.per_page, offset);
    const whereClause = where.join(' AND ');

    const [totalRes, dataRes] = await Promise.all([
      this.pool.query(`SELECT COUNT(*)::int AS total FROM tasks WHERE ${whereClause}`, values.slice(0, values.length - 2)),
      this.pool.query(
        `SELECT * FROM tasks WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      ),
    ]);

    const total = totalRes.rows[0].total as number;
    return {
      data: dataRes.rows.map((row) => this.toTaskResponse(row as Record<string, unknown>)),
      meta: { total, page: query.page, per_page: query.per_page, pages: Math.ceil(total / query.per_page) || 1 },
    };
  }

  async getTask(tenantId: string, taskId: string) {
    return this.toTaskResponse(await this.loadTaskOrThrow(tenantId, taskId));
  }

  async getTaskContext(tenantId: string, taskId: string, agentId?: string) {
    return buildTaskContext(this.pool, tenantId, await this.loadTaskOrThrow(tenantId, taskId), agentId);
  }
}
