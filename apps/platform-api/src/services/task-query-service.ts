import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { buildTaskContext } from './task-context-service.js';
import type { ListTaskQuery } from './task-service.types.js';

export class TaskQueryService {
  constructor(private readonly pool: DatabasePool) {}

  async loadTaskOrThrow(tenantId: string, taskId: string, client?: DatabaseClient) {
    const db = client ?? this.pool;
    const repo = new TenantScopedRepository(db, tenantId);
    const task = await repo.findById<Record<string, unknown> & { tenant_id: string }>('tasks', '*', taskId);
    if (!task) throw new NotFoundError('Task not found');
    return task;
  }

  toTaskResponse(task: Record<string, unknown>) {
    const metadata = (task.metadata ?? {}) as Record<string, unknown>;
    return {
      ...task,
      description: metadata.description ?? null,
      parent_id: metadata.parent_id ?? null,
      verification: metadata.verification ?? null,
    };
  }

  async listTasks(tenantId: string, query: ListTaskQuery) {
    const repo = new TenantScopedRepository(this.pool, tenantId);

    // Extra conditions beyond tenant_id (which the repository always prepends).
    // Placeholders start at $2 because $1 is always the tenantId.
    const conditions: string[] = [];
    const values: unknown[] = [];

    const arrayFilters: Array<[string | undefined, string]> = [
      [query.state, 'state = ANY($%s::task_state[])'],
      [query.type, 'type = ANY($%s::task_type[])'],
    ];
    for (const [filter, template] of arrayFilters) {
      if (!filter) continue;
      values.push(filter.split(','));
      conditions.push(template.replace('%s', String(values.length + 1)));
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
      conditions.push(`${column} = $${values.length + 1}`);
    }

    const offset = (query.page - 1) * query.per_page;

    const [total, rows] = await Promise.all([
      repo.count('tasks', conditions, values),
      repo.findAllPaginated<Record<string, unknown> & { tenant_id: string }>(
        'tasks',
        '*',
        conditions,
        values,
        'created_at DESC',
        query.per_page,
        offset,
      ),
    ]);

    return {
      data: rows.map((row) => this.toTaskResponse(row as Record<string, unknown>)),
      meta: { total, page: query.page, per_page: query.per_page, pages: Math.ceil(total / query.per_page) || 1 },
    };
  }

  async getTask(tenantId: string, taskId: string) {
    return this.toTaskResponse(await this.loadTaskOrThrow(tenantId, taskId));
  }

  async getTaskGitActivity(tenantId: string, taskId: string) {
    const task = await this.loadTaskOrThrow(tenantId, taskId);
    return {
      linked_prs: Array.isArray((task.git_info as Record<string, unknown> | null)?.linked_prs)
        ? ((task.git_info as Record<string, unknown>).linked_prs as unknown[])
        : [],
      branches: Array.isArray((task.git_info as Record<string, unknown> | null)?.branches)
        ? ((task.git_info as Record<string, unknown>).branches as unknown[])
        : [],
      ci_status: (task.git_info as Record<string, unknown> | null)?.ci_status ?? null,
      merge_history: Array.isArray((task.git_info as Record<string, unknown> | null)?.merge_history)
        ? ((task.git_info as Record<string, unknown>).merge_history as unknown[])
        : [],
      raw: (task.git_info as Record<string, unknown> | null) ?? {},
    };
  }

  async getTaskContext(tenantId: string, taskId: string, agentId?: string) {
    return buildTaskContext(this.pool, tenantId, await this.loadTaskOrThrow(tenantId, taskId), agentId);
  }
}
