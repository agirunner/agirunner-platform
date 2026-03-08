import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { AgentBusyError, ForbiddenError, NotFoundError } from '../errors/domain-errors.js';
import { assertValidTransition } from '../orchestration/task-state-machine.js';
import { EventService } from './event-service.js';
import type { ResolvedRoleConfig } from './model-catalog-service.js';
import { computeToolMatch, readAgentToolRequirements, resolveProjectToolTags } from './tool-tag-service.js';

const priorityCase = "CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END";

interface TaskClaimDependencies {
  pool: DatabasePool;
  eventService: EventService;
  toTaskResponse: (task: Record<string, unknown>) => Record<string, unknown>;
  getTaskContext: (tenantId: string, taskId: string, agentId?: string) => Promise<unknown>;
  resolveRoleConfig?: (tenantId: string, roleName: string) => Promise<ResolvedRoleConfig | null>;
}

export class TaskClaimService {
  constructor(private readonly deps: TaskClaimDependencies) {}

  async claimTask(
    identity: ApiKeyIdentity,
    payload: { agent_id: string; worker_id?: string; capabilities: string[]; workflow_id?: string; include_context?: boolean },
  ): Promise<Record<string, unknown> | null> {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE tasks
            SET state = 'ready',
                state_changed_at = now()
          WHERE tenant_id = $1
            AND state = 'pending'
            AND metadata ? 'retry_available_at'
            AND ($2::uuid IS NULL OR workflow_id = $2::uuid)
            AND (metadata->>'retry_available_at')::timestamptz <= now()`,
        [identity.tenantId, payload.workflow_id ?? null],
      );

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
         LEFT JOIN workflows ON workflows.tenant_id = tasks.tenant_id AND workflows.id = tasks.workflow_id
         WHERE tasks.tenant_id = $1
           AND tasks.state = 'ready'
           AND tasks.capabilities_required <@ $2::text[]
           AND ($3::uuid IS NULL OR tasks.workflow_id = $3::uuid)
           AND (workflows.id IS NULL OR workflows.state <> 'paused')
           AND (
             NOT (tasks.metadata ? 'preferred_agent_id')
             OR NULLIF(tasks.metadata->>'preferred_agent_id', '') IS NULL
             OR tasks.metadata->>'preferred_agent_id' = $4
           )
           AND (
             NOT (tasks.metadata ? 'preferred_worker_id')
             OR NULLIF(tasks.metadata->>'preferred_worker_id', '') IS NULL
             OR tasks.metadata->>'preferred_worker_id' = COALESCE($5, tasks.metadata->>'preferred_worker_id')
           )
         ORDER BY
           CASE WHEN tasks.metadata->>'preferred_agent_id' = $4 THEN 1 ELSE 0 END DESC,
           CASE WHEN tasks.metadata->>'preferred_worker_id' = COALESCE($5, tasks.metadata->>'preferred_worker_id') THEN 1 ELSE 0 END DESC,
           ${priorityCase} DESC,
           tasks.created_at ASC
         LIMIT 25
         FOR UPDATE OF tasks SKIP LOCKED`,
        [identity.tenantId, payload.capabilities, payload.workflow_id ?? null, payload.agent_id, payload.worker_id ?? null],
      );

      if (!taskRes.rowCount) {
        await client.query('COMMIT');
        return null;
      }

      const agentTools = readAgentToolRequirements(agent);
      let task: Record<string, unknown> | null = null;
      let toolMatch = { matched: [] as string[], unavailable_optional: [] as string[] };
      for (const candidate of taskRes.rows as Record<string, unknown>[]) {
        const projectTools = await resolveProjectToolTags(
          client,
          identity.tenantId,
          (candidate.project_id as string | null | undefined) ?? null,
        );
        const evaluation = computeToolMatch(projectTools, agentTools);
        if (evaluation.matches) {
          task = candidate;
          toolMatch = {
            matched: evaluation.matched,
            unavailable_optional: evaluation.unavailable_optional,
          };
          break;
        }
      }

      if (!task) {
        await client.query('COMMIT');
        return null;
      }
      assertValidTransition(task.id as string, task.state as Parameters<typeof assertValidTransition>[1], 'claimed');

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
      const enrichedTask = await this.enrichWithLLMCredentials(
        identity.tenantId,
        claimedTask,
      );
      const { context: _taskContext, ...claimedTaskBase } = enrichedTask as Record<string, unknown>;
      const instructionContext = (await this.deps.getTaskContext(
        identity.tenantId,
        task.id as string,
        payload.agent_id,
      )) as Record<string, unknown>;
      const instructions =
        typeof instructionContext.instructions === 'string' ? instructionContext.instructions : '';
      if ((payload.include_context ?? true) === false) {
        return {
          ...claimedTaskBase,
          tools: toolMatch,
          instructions,
        };
      }

      return {
        ...claimedTaskBase,
        tools: toolMatch,
        instructions,
        context: instructionContext,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async enrichWithLLMCredentials(
    tenantId: string,
    task: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.deps.resolveRoleConfig) return task;

    const roleName = (task.role as string) || (task.type as string) || '';
    if (!roleName) return task;

    const resolved = await this.deps.resolveRoleConfig(tenantId, roleName);
    if (!resolved) return task;

    const existingRoleConfig = (task.role_config ?? {}) as Record<string, unknown>;
    const llmFields: Record<string, unknown> = {
      llm_provider: resolved.provider.name,
      llm_model: resolved.model.modelId,
    };
    if (resolved.provider.apiKeySecretRef) {
      llmFields.llm_api_key = resolved.provider.apiKeySecretRef;
    }
    if (resolved.provider.baseUrl) {
      llmFields.llm_base_url = resolved.provider.baseUrl;
    }
    if (resolved.model.endpointType) {
      llmFields.llm_endpoint_type = resolved.model.endpointType;
    }

    return {
      ...task,
      role_config: { ...existingRoleConfig, ...llmFields },
    };
  }
}
