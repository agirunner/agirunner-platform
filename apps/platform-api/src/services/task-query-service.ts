import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { NotFoundError } from '../errors/domain-errors.js';
import type { LogService } from '../logging/log-service.js';
import { logPredecessorHandoffResolution } from '../logging/predecessor-handoff-log.js';
import { logTaskContextAttachments } from '../logging/task-context-log.js';
import {
  normalizeTaskState,
} from '../orchestration/task-state-machine.js';
import { sanitizeSecretLikeValue } from './secret-redaction.js';
import { buildTaskContext, summarizeTaskContextAttachments } from './task-context-service/task-context-service.js';
import type { ListTaskQuery } from './task-service.types.js';
import type { RelevantHandoffResolution } from './predecessor-handoff-resolver.js';

const SECRET_REDACTION = 'redacted://task-secret';

export type TaskResponseRecord = Record<string, unknown> & {
  id: string | null;
  state: unknown;
  workflow_id: string | null;
  work_item_id: string | null;
  stage_name: string | null;
  assigned_agent_id: string | null;
  assigned_worker_id: string | null;
  description: unknown;
  parent_id: unknown;
  verification: unknown;
  latest_handoff?: unknown;
  execution_backend?: 'runtime_only' | 'runtime_plus_task';
  execution_environment?: Record<string, unknown> | null;
  used_task_sandbox?: boolean;
};

export class TaskQueryService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly logService?: LogService,
  ) {}

  async loadTaskOrThrow(tenantId: string, taskId: string, client?: DatabaseClient) {
    const db = client ?? this.pool;
    const repo = new TenantScopedRepository(db, tenantId);
    const task = await repo.findById<Record<string, unknown> & { tenant_id: string }>('tasks', '*', taskId);
    if (!task) throw new NotFoundError('Task not found');
    return task;
  }

  toTaskResponse(task: Record<string, unknown>): TaskResponseRecord {
    const sanitizedTask = sanitizeTaskRecord(task);
    const metadata = (sanitizedTask.metadata ?? {}) as Record<string, unknown>;
    const executionEnvironment = normalizeExecutionEnvironmentSnapshot(
      sanitizedTask.execution_environment_snapshot,
    );
    return {
      ...sanitizedTask,
      state: normalizeResponseTaskState(sanitizedTask.state),
      description: metadata.description ?? null,
      parent_id: metadata.parent_id ?? null,
      verification: metadata.verification ?? null,
      execution_environment: executionEnvironment,
      used_task_sandbox: sanitizedTask.used_task_sandbox ?? false,
    } as TaskResponseRecord;
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
      [query.workspace_id, 'workspace_id'],
      [query.assigned_agent_id, 'assigned_agent_id'],
      [query.workflow_id, 'workflow_id'],
      [query.work_item_id, 'work_item_id'],
      [query.escalation_task_id, "metadata->>'escalation_task_id'"],
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
    const enrichedRows = await this.attachSandboxUsage(tenantId, rows);

    return {
      data: enrichedRows.map((row) => this.toTaskResponse(row as Record<string, unknown>)),
      meta: { total, page: query.page, per_page: query.per_page, pages: Math.ceil(total / query.per_page) || 1 },
    };
  }

  async getTask(tenantId: string, taskId: string) {
    const task = await this.loadTaskOrThrow(tenantId, taskId);
    const [enrichedTask] = await this.attachSandboxUsage(tenantId, [task]);
    const latestHandoff = await this.loadLatestTaskHandoff(tenantId, taskId);
    return this.toTaskResponse({
      ...(enrichedTask ?? task),
      ...(latestHandoff ? { latest_handoff: latestHandoff } : {}),
    });
  }

  async getTaskGitActivity(tenantId: string, taskId: string) {
    const task = await this.loadTaskOrThrow(tenantId, taskId);
    const gitInfo = sanitizeSecretLikeValue((task.git_info as Record<string, unknown> | null) ?? {}, {
      redactionValue: SECRET_REDACTION,
      allowSecretReferences: false,
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
    const task = await this.loadTaskOrThrow(tenantId, taskId);
    const context = await buildTaskContext(this.pool, tenantId, task, agentId);
    const contextTask = readTaskContextRecord(context.task);
    const resolution = readRelevantHandoffResolution(context.task);
    if (resolution) {
      await logPredecessorHandoffResolution(this.logService, {
        tenantId,
        operation: 'task.context.predecessor_handoff.attach',
        task,
        resolution,
        contextAnchor: readTaskContextRecord(contextTask.context_anchor),
      });
    }
    await logTaskContextAttachments(this.logService, {
      tenantId,
      task,
      summary: summarizeTaskContextAttachments(context),
    });
    return context;
  }

  private async loadLatestTaskHandoff(tenantId: string, taskId: string) {
    const result = await this.pool.query(
      `SELECT id,
              task_id,
              role,
              summary,
              completion,
              resolution,
              changes,
              decisions,
              remaining_items,
              blockers,
              focus_areas,
              known_risks,
              successor_context,
              role_data,
              artifact_ids,
              created_at
         FROM task_handoffs
        WHERE tenant_id = $1
          AND task_id = $2
        LIMIT 1`,
      [tenantId, taskId],
    );
    const row = (result.rows[0] as Record<string, unknown> | undefined) ?? null;
    if (!row) {
      return null;
    }
    return normalizeTaskHandoff(row);
  }

  private async attachSandboxUsage<T extends Record<string, unknown>>(tenantId: string, tasks: T[]) {
    const taskIds = tasks
      .map((task) => (typeof task.id === 'string' ? task.id : null))
      .filter((taskId): taskId is string => taskId !== null);
    if (taskIds.length === 0) {
      return tasks.map((task) => ({ ...task, used_task_sandbox: false }));
    }

    const result = await this.pool.query<{ task_id: string }>(
      `SELECT task_id
         FROM execution_container_leases
        WHERE tenant_id = $1
          AND task_id = ANY($2::uuid[])`,
      [tenantId, taskIds],
    );
    const leasedTaskIds = new Set(result.rows.map((row) => row.task_id));
    return tasks.map((task) => ({
      ...task,
      used_task_sandbox: typeof task.id === 'string' && leasedTaskIds.has(task.id),
    }));
  }
}

function sanitizeTaskRecord(task: Record<string, unknown>): Record<string, unknown> {
  return sanitizeSecretLikeValue(task, {
    redactionValue: SECRET_REDACTION,
    allowSecretReferences: false,
  }) as Record<string, unknown>;
}

function readTaskContextRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizeResponseTaskState(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const normalized = normalizeTaskState(value);
  if (normalized) {
    return normalized;
  }
  throw new Error(`Persisted task state must be canonical. Found '${value}'.`);
}

function normalizeTaskHandoff(row: Record<string, unknown>) {
  return {
    ...row,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at ?? null,
  };
}

function normalizeExecutionEnvironmentSnapshot(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readRelevantHandoffResolution(taskContext: unknown): RelevantHandoffResolution | null {
  if (!isRecord(taskContext)) {
    return null;
  }
  const resolution = taskContext.predecessor_handoff_resolution;
  if (!isRecord(resolution) || !Array.isArray(resolution.handoffs) || typeof resolution.source !== 'string') {
    return null;
  }
  return resolution as unknown as RelevantHandoffResolution;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
