import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { NotFoundError } from '../errors/domain-errors.js';
import {
  normalizeLegacyTaskStateAlias,
  normalizeTaskState,
} from '../orchestration/task-state-machine.js';
import { sanitizeSecretLikeValue } from './secret-redaction.js';
import { buildTaskContext } from './task-context-service.js';
import type { ListTaskQuery } from './task-service.types.js';

const SECRET_REDACTION = 'redacted://task-secret';
const secretLikeKeyPattern = /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|known_hosts)/i;

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
    const sanitizedTask = sanitizeTaskRecord(task);
    const metadata = (sanitizedTask.metadata ?? {}) as Record<string, unknown>;
    return {
      ...sanitizedTask,
      state: normalizeResponseTaskState(sanitizedTask.state),
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
    ];
    for (const [filter, template] of arrayFilters) {
      if (!filter) continue;
      values.push(filter.split(','));
      conditions.push(template.replace('%s', String(values.length + 1)));
    }

    const exactFilters: Array<[string | undefined, string]> = [
      [query.project_id, 'project_id'],
      [query.assigned_agent_id, 'assigned_agent_id'],
      [query.workflow_id, 'workflow_id'],
      [query.work_item_id, 'work_item_id'],
      [query.stage_name, 'stage_name'],
      [query.activation_id, 'activation_id'],
      [query.parent_id, "metadata->>'parent_id'"],
    ];
    for (const [filter, column] of exactFilters) {
      if (!filter) continue;
      values.push(filter);
      conditions.push(`${column} = $${values.length + 1}`);
    }

    if (query.is_orchestrator_task !== undefined) {
      values.push(query.is_orchestrator_task);
      conditions.push(`is_orchestrator_task = $${values.length + 1}`);
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
    const gitInfo = sanitizeSecretLikeValue((task.git_info as Record<string, unknown> | null) ?? {}, {
      redactionValue: SECRET_REDACTION,
    }) as Record<string, unknown>;
    return {
      linked_prs: Array.isArray(gitInfo.linked_prs)
        ? (gitInfo.linked_prs as unknown[])
        : [],
      branches: Array.isArray(gitInfo.branches)
        ? (gitInfo.branches as unknown[])
        : [],
      ci_status: gitInfo.ci_status ?? null,
      merge_history: Array.isArray(gitInfo.merge_history)
        ? (gitInfo.merge_history as unknown[])
        : [],
      raw: gitInfo,
    };
  }

  async getTaskContext(tenantId: string, taskId: string, agentId?: string) {
    return buildTaskContext(this.pool, tenantId, await this.loadTaskOrThrow(tenantId, taskId), agentId);
  }
}

function sanitizeTaskRecord(task: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(task)) {
    sanitized[key] = sanitizeValue(value, isSecretLikeKey(key));
  }
  return sanitized;
}

function sanitizeValue(value: unknown, inheritedSecret: boolean): unknown {
  if (typeof value === 'string') {
    if (!inheritedSecret || isAllowedSecretReference(value)) {
      return value;
    }
    return value.trim().length === 0 ? value : SECRET_REDACTION;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, inheritedSecret));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = sanitizeValue(nestedValue, inheritedSecret || isSecretLikeKey(key));
  }
  return sanitized;
}

function isAllowedSecretReference(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith('secret:') || normalized.startsWith('redacted://');
}

function isSecretLikeKey(key: string): boolean {
  return secretLikeKeyPattern.test(key);
}

function normalizeResponseTaskState(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  return normalizeTaskState(value) ?? normalizeLegacyTaskStateAlias(value) ?? value;
}
