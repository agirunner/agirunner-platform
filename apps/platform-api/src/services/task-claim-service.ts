import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { AgentBusyError, ForbiddenError, NotFoundError } from '../errors/domain-errors.js';
import { assertValidTransition } from '../orchestration/task-state-machine.js';
import { EventService } from './event-service.js';

const priorityCase = "CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END";

interface TaskClaimDependencies {
  pool: DatabasePool;
  eventService: EventService;
  toTaskResponse: (task: Record<string, unknown>) => Record<string, unknown>;
  getTaskContext: (tenantId: string, taskId: string, agentId?: string) => Promise<unknown>;
}

export class TaskClaimService {
  constructor(private readonly deps: TaskClaimDependencies) {}

  async claimTask(
    identity: ApiKeyIdentity,
    payload: { agent_id: string; worker_id?: string; capabilities: string[]; pipeline_id?: string; include_context?: boolean },
  ) {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');

      const agentRes = await client.query('SELECT * FROM agents WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [
        identity.tenantId,
        payload.agent_id,
      ]);
      if (!agentRes.rowCount) throw new NotFoundError('Agent not found');

      const agent = agentRes.rows[0];
      if (identity.scope === 'worker') {
        if (!identity.ownerId) {
          throw new ForbiddenError('Worker identity is not bound to a worker owner.');
        }

        if (agent.worker_id !== identity.ownerId) {
          throw new ForbiddenError('Worker cannot claim tasks with an agent owned by a different worker.');
        }

        if (payload.worker_id && payload.worker_id !== identity.ownerId) {
          throw new ForbiddenError('Worker cannot claim tasks on behalf of a different worker.');
        }
      }

      if (payload.worker_id && agent.worker_id !== payload.worker_id) {
        throw new ForbiddenError('Worker cannot claim tasks with an agent owned by a different worker.');
      }

      if (agent.current_task_id) {
        throw new AgentBusyError(`Agent already holds task '${agent.current_task_id}'. Complete or fail it first.`, {
          current_task_id: agent.current_task_id,
        });
      }

      const taskRes = await client.query(
        `SELECT tasks.* FROM tasks
         LEFT JOIN pipelines ON pipelines.tenant_id = tasks.tenant_id AND pipelines.id = tasks.pipeline_id
         WHERE tenant_id = $1
           AND state = 'ready'
           AND capabilities_required <@ $2::text[]
           AND ($3::uuid IS NULL OR pipeline_id = $3::uuid)
           AND (pipelines.id IS NULL OR pipelines.state <> 'paused')
           AND (
             NOT (metadata ? 'preferred_agent_id')
             OR NULLIF(metadata->>'preferred_agent_id', '') IS NULL
             OR metadata->>'preferred_agent_id' = $4
           )
           AND (
             NOT (metadata ? 'preferred_worker_id')
             OR NULLIF(metadata->>'preferred_worker_id', '') IS NULL
             OR metadata->>'preferred_worker_id' = COALESCE($5, metadata->>'preferred_worker_id')
           )
         ORDER BY
           CASE WHEN metadata->>'preferred_agent_id' = $4 THEN 1 ELSE 0 END DESC,
           CASE WHEN metadata->>'preferred_worker_id' = COALESCE($5, metadata->>'preferred_worker_id') THEN 1 ELSE 0 END DESC,
           ${priorityCase} DESC,
           created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [identity.tenantId, payload.capabilities, payload.pipeline_id ?? null, payload.agent_id, payload.worker_id ?? null],
      );

      if (!taskRes.rowCount) {
        await client.query('COMMIT');
        return null;
      }

      const task = taskRes.rows[0];
      assertValidTransition(task.id as string, task.state, 'claimed');

      const updatedTaskRes = await client.query(
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

      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.state_changed',
          entityType: 'task',
          entityId: task.id as string,
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
      const claimedTask = this.deps.toTaskResponse(updatedTaskRes.rows[0] as Record<string, unknown>);
      if ((payload.include_context ?? true) === false) {
        return claimedTask;
      }

      return {
        ...claimedTask,
        context: await this.deps.getTaskContext(identity.tenantId, task.id as string, payload.agent_id),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
