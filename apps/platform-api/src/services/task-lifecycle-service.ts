import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ConflictError, ForbiddenError } from '../errors/domain-errors.js';
import { assertValidTransition, type TaskState } from '../orchestration/task-state-machine.js';
import { applyTaskCompletionSideEffects } from './task-completion-side-effects.js';
import { EventService } from './event-service.js';
import { PipelineStateService } from './pipeline-state-service.js';

interface TransitionOptions {
  expectedStates: TaskState[];
  requireAssignment?: { agentId?: string; workerId?: string };
  output?: unknown;
  error?: unknown;
  reason?: string;
  retryIncrement?: boolean;
  clearAssignment?: boolean;
  clearExecutionData?: boolean;
}

interface TaskLifecycleDependencies {
  pool: DatabasePool;
  eventService: EventService;
  pipelineStateService: PipelineStateService;
  loadTaskOrThrow: (tenantId: string, taskId: string, client?: DatabaseClient) => Promise<Record<string, unknown>>;
  toTaskResponse: (task: Record<string, unknown>) => Record<string, unknown>;
}

export class TaskLifecycleService {
  constructor(private readonly deps: TaskLifecycleDependencies) {}

  private requireCallingAgentId(identity: ApiKeyIdentity): string {
    if (identity.scope !== 'agent' || !identity.ownerId) {
      throw new ForbiddenError('Agent identity is required for task lifecycle operations');
    }
    return identity.ownerId;
  }

  async applyStateTransition(identity: ApiKeyIdentity, taskId: string, nextState: TaskState, options: TransitionOptions) {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');
      const task = await this.deps.loadTaskOrThrow(identity.tenantId, taskId, client);

      if (!options.expectedStates.includes(task.state as TaskState)) {
        assertValidTransition(task.id as string, task.state as TaskState, nextState);
      }

      if (options.requireAssignment?.agentId && task.assigned_agent_id !== options.requireAssignment.agentId) {
        throw new ForbiddenError('Task is assigned to a different agent');
      }
      if (options.requireAssignment?.workerId && task.assigned_worker_id !== options.requireAssignment.workerId) {
        throw new ConflictError('Task is assigned to a different worker');
      }

      const updateFragments: string[] = ['state = $3', 'state_changed_at = now()'];
      const values: unknown[] = [identity.tenantId, taskId, nextState];
      if (nextState === 'running') updateFragments.push('started_at = now()');
      if (nextState === 'completed') {
        updateFragments.push('completed_at = now()', 'output = $4', 'error = NULL');
        values.push(options.output ?? {});
      }
      if (nextState === 'failed') {
        updateFragments.push('error = $4');
        values.push(options.error ?? { category: 'unknown', message: options.reason ?? 'failed', recoverable: false });
      }
      if (options.retryIncrement) updateFragments.push('retry_count = retry_count + 1');
      if (options.clearAssignment) updateFragments.push('assigned_agent_id = NULL', 'assigned_worker_id = NULL', 'claimed_at = NULL', 'started_at = NULL');
      if (options.clearExecutionData) updateFragments.push('output = NULL', 'error = NULL', 'metrics = NULL', 'git_info = NULL');

      const updateSql = `UPDATE tasks SET ${updateFragments.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`;
      const updatedTask = (await client.query(updateSql, values)).rows[0] as Record<string, unknown>;

      if (options.clearAssignment && task.assigned_agent_id) {
        await client.query(
          `UPDATE agents
           SET current_task_id = NULL,
               status = (CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'idle' END)::agent_status
           WHERE tenant_id = $1 AND id = $2`,
          [identity.tenantId, task.assigned_agent_id],
        );
      }

      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.state_changed',
          entityType: 'task',
          entityId: taskId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: { from_state: task.state, to_state: nextState, reason: options.reason },
        },
        client,
      );

      if (nextState === 'completed') {
        await applyTaskCompletionSideEffects(this.deps.eventService, identity, updatedTask, client);
      }

      if (task.pipeline_id) {
        await this.deps.pipelineStateService.recomputePipelineState(identity.tenantId, task.pipeline_id as string, client, {
          actorType: 'system',
          actorId: 'task_state_transition',
        });
      }

      await client.query('COMMIT');
      return this.deps.toTaskResponse(updatedTask);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async startTask(identity: ApiKeyIdentity, taskId: string, payload: { agent_id?: string; worker_id?: string }) {
    const callingAgentId = this.requireCallingAgentId(identity);
    if (payload.agent_id && payload.agent_id !== callingAgentId) throw new ForbiddenError('Task can only be started by the assigned agent');
    return this.applyStateTransition(identity, taskId, 'running', {
      expectedStates: ['claimed'],
      requireAssignment: { agentId: callingAgentId, workerId: payload.worker_id },
      reason: 'task_started',
    });
  }

  async completeTask(identity: ApiKeyIdentity, taskId: string, payload: { output: unknown }) {
    return this.applyStateTransition(identity, taskId, 'completed', {
      expectedStates: ['running'],
      requireAssignment: { agentId: this.requireCallingAgentId(identity) },
      output: payload.output,
      clearAssignment: true,
      reason: 'task_completed',
    });
  }

  async failTask(identity: ApiKeyIdentity, taskId: string, payload: { error: Record<string, unknown> }) {
    const callingAgentId = this.requireCallingAgentId(identity);
    const task = await this.deps.loadTaskOrThrow(identity.tenantId, taskId);
    const shouldRetry = Boolean(task.auto_retry) && Number(task.retry_count) < Number(task.max_retries);
    return shouldRetry
      ? this.applyStateTransition(identity, taskId, 'ready', {
          expectedStates: ['running', 'claimed'],
          requireAssignment: { agentId: callingAgentId },
          retryIncrement: true,
          clearAssignment: true,
          reason: 'auto_retry',
          clearExecutionData: true,
        })
      : this.applyStateTransition(identity, taskId, 'failed', {
          expectedStates: ['running', 'claimed'],
          requireAssignment: { agentId: callingAgentId },
          error: payload.error,
          clearAssignment: true,
          reason: 'task_failed',
        });
  }

  async approveTask(identity: ApiKeyIdentity, taskId: string) {
    return this.applyStateTransition(identity, taskId, 'ready', { expectedStates: ['awaiting_approval'], reason: 'approved' });
  }

  async retryTask(identity: ApiKeyIdentity, taskId: string) {
    const task = await this.deps.loadTaskOrThrow(identity.tenantId, taskId);
    if (task.state !== 'failed') throw new ConflictError('Task is not retryable');
    return this.applyStateTransition(identity, taskId, 'ready', {
      expectedStates: ['failed'],
      retryIncrement: true,
      clearAssignment: true,
      clearExecutionData: true,
      reason: 'manual_retry',
    });
  }

  async cancelTask(identity: ApiKeyIdentity, taskId: string) {
    const task = await this.deps.loadTaskOrThrow(identity.tenantId, taskId);
    if (task.state === 'completed') throw new ConflictError('Completed task cannot be cancelled');
    return this.applyStateTransition(identity, taskId, 'cancelled', {
      expectedStates: ['pending', 'ready', 'claimed', 'running', 'awaiting_approval', 'output_pending_review', 'failed'],
      clearAssignment: true,
      reason: 'cancelled',
    });
  }
}
