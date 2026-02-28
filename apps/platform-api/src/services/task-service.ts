import type { Pool, PoolClient } from 'pg';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import { AgentBusyError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { assertValidTransition, type TaskState } from '../orchestration/task-state-machine.js';
import { EventService } from './event-service.js';

interface CreateTaskInput {
  title: string;
  type: string;
  description?: string;
  priority?: string;
  pipeline_id?: string;
  project_id?: string;
  parent_id?: string;
  role?: string;
  input?: Record<string, unknown>;
  depends_on?: string[];
  requires_approval?: boolean;
  capabilities_required?: string[];
  role_config?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  resource_bindings?: unknown[];
  timeout_minutes?: number;
  token_budget?: number;
  cost_cap_usd?: number;
  auto_retry?: boolean;
  max_retries?: number;
  metadata?: Record<string, unknown>;
}

interface ListTaskQuery {
  state?: string;
  type?: string;
  project_id?: string;
  assigned_agent_id?: string;
  parent_id?: string;
  pipeline_id?: string;
  page: number;
  per_page: number;
}

const priorityCase = "CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END";

export class TaskService {
  constructor(
    private readonly pool: Pool,
    private readonly eventService: EventService,
  ) {}

  private async loadTaskOrThrow(tenantId: string, taskId: string, client?: PoolClient) {
    const db = client ?? this.pool;
    const result = await db.query('SELECT * FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskId]);
    if (!result.rowCount) {
      throw new NotFoundError('Task not found');
    }
    return result.rows[0];
  }

  private toTaskResponse(task: Record<string, unknown>) {
    const metadata = (task.metadata ?? {}) as Record<string, unknown>;
    return {
      ...task,
      description: metadata.description ?? null,
      parent_id: metadata.parent_id ?? null,
    };
  }

  async createTask(identity: ApiKeyIdentity, input: CreateTaskInput) {
    if (!input.title?.trim()) {
      throw new ValidationError('title is required');
    }

    const dependsOn = input.depends_on ?? [];
    const requiresApproval = input.requires_approval ?? false;

    if (dependsOn.length > 0) {
      const checkDependencies = await this.pool.query(
        'SELECT id FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [identity.tenantId, dependsOn],
      );
      if (checkDependencies.rowCount !== dependsOn.length) {
        throw new NotFoundError('One or more dependency tasks were not found');
      }
    }

    const initialState = dependsOn.length > 0 ? 'pending' : requiresApproval ? 'awaiting_approval' : 'ready';
    const metadata = {
      ...(input.metadata ?? {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.parent_id ? { parent_id: input.parent_id } : {}),
    };

    const insertResult = await this.pool.query(
      `INSERT INTO tasks (
        tenant_id, pipeline_id, project_id, title, type, role, priority, state, depends_on,
        requires_approval, input, capabilities_required, role_config, environment,
        resource_bindings, timeout_minutes, token_budget, cost_cap_usd,
        auto_retry, max_retries, metadata
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[],$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
      ) RETURNING *`,
      [
        identity.tenantId,
        input.pipeline_id ?? null,
        input.project_id ?? null,
        input.title,
        input.type,
        input.role ?? null,
        input.priority ?? 'normal',
        initialState,
        dependsOn,
        requiresApproval,
        input.input ?? {},
        input.capabilities_required ?? [],
        input.role_config ?? null,
        input.environment ?? null,
        input.resource_bindings ?? [],
        input.timeout_minutes ?? 30,
        input.token_budget ?? null,
        input.cost_cap_usd ?? null,
        input.auto_retry ?? false,
        input.max_retries ?? 0,
        metadata,
      ],
    );

    const task = insertResult.rows[0];
    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'task.created',
      entityType: 'task',
      entityId: task.id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { state: initialState },
    });

    return this.toTaskResponse(task);
  }

  async listTasks(tenantId: string, query: ListTaskQuery) {
    const where: string[] = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];

    if (query.state) {
      values.push(query.state.split(','));
      where.push(`state = ANY($${values.length}::task_state[])`);
    }
    if (query.type) {
      values.push(query.type.split(','));
      where.push(`type = ANY($${values.length}::task_type[])`);
    }
    if (query.project_id) {
      values.push(query.project_id);
      where.push(`project_id = $${values.length}`);
    }
    if (query.assigned_agent_id) {
      values.push(query.assigned_agent_id);
      where.push(`assigned_agent_id = $${values.length}`);
    }
    if (query.pipeline_id) {
      values.push(query.pipeline_id);
      where.push(`pipeline_id = $${values.length}`);
    }
    if (query.parent_id) {
      values.push(query.parent_id);
      where.push(`metadata->>'parent_id' = $${values.length}`);
    }

    const offset = (query.page - 1) * query.per_page;
    values.push(query.per_page, offset);

    const baseWhere = where.join(' AND ');
    const [totalRes, dataRes] = await Promise.all([
      this.pool.query(`SELECT COUNT(*)::int AS total FROM tasks WHERE ${baseWhere}`, values.slice(0, values.length - 2)),
      this.pool.query(
        `SELECT * FROM tasks WHERE ${baseWhere} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      ),
    ]);

    const total = totalRes.rows[0].total as number;
    return {
      data: dataRes.rows.map((row) => this.toTaskResponse(row)),
      meta: {
        total,
        page: query.page,
        per_page: query.per_page,
        pages: Math.ceil(total / query.per_page) || 1,
      },
    };
  }

  async getTask(tenantId: string, taskId: string) {
    const task = await this.loadTaskOrThrow(tenantId, taskId);
    return this.toTaskResponse(task);
  }

  async updateTask(tenantId: string, taskId: string, payload: Record<string, unknown>) {
    if ('state' in payload) {
      throw new ConflictError('Task state cannot be changed via PATCH /tasks/:id');
    }

    const task = await this.loadTaskOrThrow(tenantId, taskId);
    const nextMetadata = {
      ...((task.metadata ?? {}) as Record<string, unknown>),
      ...(typeof payload.description === 'string' ? { description: payload.description } : {}),
      ...(typeof payload.parent_id === 'string' ? { parent_id: payload.parent_id } : {}),
      ...(payload.metadata && typeof payload.metadata === 'object' ? (payload.metadata as Record<string, unknown>) : {}),
    };

    const result = await this.pool.query(
      `UPDATE tasks SET
        title = COALESCE($3, title),
        priority = COALESCE($4::task_priority, priority),
        capabilities_required = COALESCE($5::text[], capabilities_required),
        metadata = $6,
        timeout_minutes = COALESCE($7, timeout_minutes),
        input = CASE WHEN $8::jsonb IS NULL THEN input ELSE jsonb_set(input, '{description}', to_jsonb($8::text), true) END
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
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

    if (!result.rowCount) {
      throw new NotFoundError('Task not found');
    }

    return this.toTaskResponse(result.rows[0]);
  }

  async getTaskContext(tenantId: string, taskId: string, agentId?: string) {
    const task = await this.loadTaskOrThrow(tenantId, taskId);

    let agent = null;
    if (agentId) {
      const agentRes = await this.pool.query(
        'SELECT id, name, capabilities, metadata FROM agents WHERE tenant_id = $1 AND id = $2',
        [tenantId, agentId],
      );
      agent = agentRes.rows[0] ?? null;
    } else if (task.assigned_agent_id) {
      const agentRes = await this.pool.query(
        'SELECT id, name, capabilities, metadata FROM agents WHERE tenant_id = $1 AND id = $2',
        [tenantId, task.assigned_agent_id],
      );
      agent = agentRes.rows[0] ?? null;
    }

    const [projectRes, pipelineRes, depsRes] = await Promise.all([
      task.project_id
        ? this.pool.query('SELECT id, name, description, memory FROM projects WHERE tenant_id = $1 AND id = $2', [tenantId, task.project_id])
        : Promise.resolve({ rows: [] }),
      task.pipeline_id
        ? this.pool.query('SELECT id, name, context, git_branch FROM pipelines WHERE tenant_id = $1 AND id = $2', [tenantId, task.pipeline_id])
        : Promise.resolve({ rows: [] }),
      (task.depends_on as string[]).length > 0
        ? this.pool.query(
            "SELECT id, role, type, output FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND state = 'completed'",
            [tenantId, task.depends_on],
          )
        : Promise.resolve({ rows: [] }),
    ]);

    const upstreamOutputs = Object.fromEntries(
      depsRes.rows.map((row) => [row.role ?? row.type ?? row.id, row.output ?? {}]),
    );

    return {
      agent,
      project: projectRes.rows[0] ?? null,
      pipeline: pipelineRes.rows[0] ?? null,
      task: {
        id: task.id,
        input: task.input,
        role_config: task.role_config,
        upstream_outputs: upstreamOutputs,
      },
    };
  }

  async claimTask(
    identity: ApiKeyIdentity,
    payload: { agent_id: string; worker_id?: string; capabilities: string[]; pipeline_id?: string; include_context?: boolean },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const agentRes = await client.query(
        'SELECT * FROM agents WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [identity.tenantId, payload.agent_id],
      );
      if (!agentRes.rowCount) {
        throw new NotFoundError('Agent not found');
      }

      const agent = agentRes.rows[0];
      if (agent.current_task_id) {
        throw new AgentBusyError(`Agent already holds task '${agent.current_task_id}'. Complete or fail it first.`, {
          current_task_id: agent.current_task_id,
        });
      }

      const taskRes = await client.query(
        `SELECT * FROM tasks
         WHERE tenant_id = $1
           AND state = 'ready'
           AND capabilities_required <@ $2::text[]
           AND ($3::uuid IS NULL OR pipeline_id = $3::uuid)
         ORDER BY ${priorityCase} DESC, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [identity.tenantId, payload.capabilities, payload.pipeline_id ?? null],
      );

      if (!taskRes.rowCount) {
        await client.query('COMMIT');
        return null;
      }

      const task = taskRes.rows[0];
      assertValidTransition(task.id, task.state as TaskState, 'claimed');

      const updateTaskRes = await client.query(
        `UPDATE tasks
         SET state = 'claimed', state_changed_at = now(),
             assigned_agent_id = $3, assigned_worker_id = $4, claimed_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [identity.tenantId, task.id, payload.agent_id, payload.worker_id ?? null],
      );

      await client.query(
        `UPDATE agents SET current_task_id = $2, status = 'busy', last_heartbeat_at = now()
         WHERE tenant_id = $1 AND id = $3`,
        [identity.tenantId, task.id, payload.agent_id],
      );

      await this.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.state_changed',
          entityType: 'task',
          entityId: task.id,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: {
            from_state: 'ready',
            to_state: 'claimed',
            agent_id: payload.agent_id,
            worker_id: payload.worker_id ?? null,
          },
        },
        client,
      );

      await client.query('COMMIT');
      const claimed = this.toTaskResponse(updateTaskRes.rows[0]);
      const includeContext = payload.include_context ?? true;
      if (!includeContext) {
        return claimed;
      }
      return {
        ...claimed,
        context: await this.getTaskContext(identity.tenantId, task.id, payload.agent_id),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async applyStateTransition(
    identity: ApiKeyIdentity,
    taskId: string,
    nextState: TaskState,
    options: {
      expectedStates: TaskState[];
      requireAssignment?: { agentId?: string; workerId?: string };
      output?: unknown;
      error?: unknown;
      reason?: string;
      retryIncrement?: boolean;
      clearAssignment?: boolean;
      clearExecutionData?: boolean;
    },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const task = await this.loadTaskOrThrow(identity.tenantId, taskId, client);

      if (!options.expectedStates.includes(task.state as TaskState)) {
        assertValidTransition(task.id, task.state as TaskState, nextState);
      }

      if (options.requireAssignment) {
        if (options.requireAssignment.agentId && task.assigned_agent_id !== options.requireAssignment.agentId) {
          throw new ForbiddenError('Task is assigned to a different agent');
        }
        if (options.requireAssignment.workerId && task.assigned_worker_id !== options.requireAssignment.workerId) {
          throw new ConflictError('Task is assigned to a different worker');
        }
      }

      const setFragments: string[] = ['state = $3', 'state_changed_at = now()'];
      const values: unknown[] = [identity.tenantId, taskId, nextState];

      if (nextState === 'running') {
        setFragments.push('started_at = now()');
      }
      if (nextState === 'completed') {
        setFragments.push('completed_at = now()', 'output = $4', 'error = NULL');
        values.push(options.output ?? {});
      }
      if (nextState === 'failed') {
        setFragments.push('error = $4');
        values.push(options.error ?? { category: 'unknown', message: options.reason ?? 'failed', recoverable: false });
      }
      if (options.retryIncrement) {
        setFragments.push('retry_count = retry_count + 1');
      }
      if (options.clearAssignment) {
        setFragments.push('assigned_agent_id = NULL', 'assigned_worker_id = NULL', 'claimed_at = NULL', 'started_at = NULL');
      }
      if (options.clearExecutionData) {
        setFragments.push('output = NULL', 'error = NULL', 'metrics = NULL', 'git_info = NULL');
      }

      const updateSql = `UPDATE tasks SET ${setFragments.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`;
      const updatedTask = (await client.query(updateSql, values)).rows[0];

      if (options.clearAssignment && task.assigned_agent_id) {
        await client.query(
          `UPDATE agents
           SET current_task_id = NULL,
               status = (CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'idle' END)::agent_status
           WHERE tenant_id = $1 AND id = $2`,
          [identity.tenantId, task.assigned_agent_id],
        );
      }

      await this.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.state_changed',
          entityType: 'task',
          entityId: taskId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: {
            from_state: task.state,
            to_state: nextState,
            reason: options.reason,
          },
        },
        client,
      );

      if (nextState === 'completed') {
        await this.handleTaskCompletionSideEffects(identity, updatedTask, client);
      }

      await client.query('COMMIT');
      return this.toTaskResponse(updatedTask);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private requireCallingAgentId(identity: ApiKeyIdentity): string {
    if (identity.scope !== 'agent' || !identity.ownerId) {
      throw new ForbiddenError('Agent identity is required for task lifecycle operations');
    }
    return identity.ownerId;
  }

  async startTask(identity: ApiKeyIdentity, taskId: string, payload: { agent_id?: string; worker_id?: string }) {
    const callingAgentId = this.requireCallingAgentId(identity);
    if (payload.agent_id && payload.agent_id !== callingAgentId) {
      throw new ForbiddenError('Task can only be started by the assigned agent');
    }

    return this.applyStateTransition(identity, taskId, 'running', {
      expectedStates: ['claimed'],
      requireAssignment: { agentId: callingAgentId, workerId: payload.worker_id },
      reason: 'task_started',
    });
  }

  async completeTask(identity: ApiKeyIdentity, taskId: string, payload: { output: unknown }) {
    const callingAgentId = this.requireCallingAgentId(identity);
    return this.applyStateTransition(identity, taskId, 'completed', {
      expectedStates: ['running'],
      requireAssignment: { agentId: callingAgentId },
      output: payload.output,
      clearAssignment: true,
      reason: 'task_completed',
    });
  }

  async failTask(identity: ApiKeyIdentity, taskId: string, payload: { error: Record<string, unknown> }) {
    const callingAgentId = this.requireCallingAgentId(identity);
    const task = await this.loadTaskOrThrow(identity.tenantId, taskId);
    const shouldRetry = Boolean(task.auto_retry) && Number(task.retry_count) < Number(task.max_retries);

    if (shouldRetry) {
      return this.applyStateTransition(identity, taskId, 'ready', {
        expectedStates: ['running', 'claimed'],
        requireAssignment: { agentId: callingAgentId },
        retryIncrement: true,
        clearAssignment: true,
        reason: 'auto_retry',
        clearExecutionData: true,
      });
    }

    return this.applyStateTransition(identity, taskId, 'failed', {
      expectedStates: ['running', 'claimed'],
      requireAssignment: { agentId: callingAgentId },
      error: payload.error,
      clearAssignment: true,
      reason: 'task_failed',
    });
  }

  async approveTask(identity: ApiKeyIdentity, taskId: string) {
    return this.applyStateTransition(identity, taskId, 'ready', {
      expectedStates: ['awaiting_approval'],
      reason: 'approved',
    });
  }

  async retryTask(identity: ApiKeyIdentity, taskId: string) {
    const task = await this.loadTaskOrThrow(identity.tenantId, taskId);
    if (task.state !== 'failed') {
      throw new ConflictError('Task is not retryable');
    }

    return this.applyStateTransition(identity, taskId, 'ready', {
      expectedStates: ['failed'],
      retryIncrement: true,
      clearAssignment: true,
      clearExecutionData: true,
      reason: 'manual_retry',
    });
  }

  async cancelTask(identity: ApiKeyIdentity, taskId: string) {
    const task = await this.loadTaskOrThrow(identity.tenantId, taskId);
    if (task.state === 'completed') {
      throw new ConflictError('Completed task cannot be cancelled');
    }

    return this.applyStateTransition(identity, taskId, 'cancelled', {
      expectedStates: ['pending', 'ready', 'claimed', 'running', 'awaiting_approval', 'output_pending_review', 'failed'],
      clearAssignment: true,
      reason: 'cancelled',
    });
  }

  private async handleTaskCompletionSideEffects(identity: ApiKeyIdentity, task: Record<string, unknown>, client: PoolClient) {
    const completedTaskId = task.id as string;
    const dependents = await client.query(
      `SELECT id, depends_on, requires_approval FROM tasks
       WHERE tenant_id = $1 AND state = 'pending' AND $2 = ANY(depends_on)`,
      [identity.tenantId, completedTaskId],
    );

    for (const dependent of dependents.rows) {
      const unfinishedDeps = await client.query(
        "SELECT 1 FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND state <> 'completed' LIMIT 1",
        [identity.tenantId, dependent.depends_on],
      );
      if (unfinishedDeps.rowCount) {
        continue;
      }

      const nextState: TaskState = dependent.requires_approval ? 'awaiting_approval' : 'ready';
      await client.query('UPDATE tasks SET state = $3, state_changed_at = now() WHERE tenant_id = $1 AND id = $2', [
        identity.tenantId,
        dependent.id,
        nextState,
      ]);

      await this.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.state_changed',
          entityType: 'task',
          entityId: dependent.id,
          actorType: 'system',
          actorId: 'dependency_resolver',
          data: { from_state: 'pending', to_state: nextState },
        },
        client,
      );
    }

    if (task.pipeline_id) {
      const contextKey = (task.role as string | null) || (task.type as string);
      await client.query(
        `UPDATE pipelines
         SET context = jsonb_set(context, $2::text[], $3::jsonb, true),
             context_size_bytes = octet_length(jsonb_set(context, $2::text[], $3::jsonb, true)::text)
         WHERE tenant_id = $1 AND id = $4`,
        [identity.tenantId, [contextKey], task.output ?? {}, task.pipeline_id],
      );
    }
  }

  async failTimedOutTasks(now = new Date()): Promise<number> {
    const identity: ApiKeyIdentity = {
      id: 'system',
      tenantId: '00000000-0000-0000-0000-000000000001',
      scope: 'admin',
      ownerType: 'system',
      ownerId: null,
      keyPrefix: 'system',
    };

    const stale = await this.pool.query(
      `SELECT id, tenant_id, auto_retry, retry_count, max_retries
       FROM tasks
       WHERE state IN ('claimed', 'running')
         AND COALESCE(started_at, claimed_at) IS NOT NULL
         AND COALESCE(started_at, claimed_at) + (timeout_minutes * INTERVAL '1 minute') < $1`,
      [now],
    );

    let affected = 0;
    for (const row of stale.rows) {
      const scopedIdentity = { ...identity, tenantId: row.tenant_id };
      const shouldRetry = Boolean(row.auto_retry) && Number(row.retry_count) < Number(row.max_retries);
      if (shouldRetry) {
        await this.applyStateTransition(scopedIdentity, row.id as string, 'ready', {
          expectedStates: ['claimed', 'running'],
          retryIncrement: true,
          clearAssignment: true,
          reason: 'timeout_auto_retry',
          clearExecutionData: true,
        });
      } else {
        await this.applyStateTransition(scopedIdentity, row.id as string, 'failed', {
          expectedStates: ['claimed', 'running'],
          error: { category: 'timeout', message: 'Task timeout exceeded', recoverable: false },
          clearAssignment: true,
          reason: 'timeout_failed',
        });
      }
      affected += 1;
    }

    return affected;
  }
}
