import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { AgentBusyError, ForbiddenError, NotFoundError } from '../errors/domain-errors.js';
import { assertValidTransition } from '../orchestration/task-state-machine.js';
import { EventService } from './event-service.js';
import type { ResolvedRoleConfig } from './model-catalog-service.js';
import { OAuthService, type ResolvedOAuthToken } from './oauth-service.js';
import { flattenInstructionLayers } from './task-context-service.js';
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
    payload: { agent_id: string; worker_id?: string; capabilities: string[]; workflow_id?: string; template_id?: string; include_context?: boolean },
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
           AND ($6::uuid IS NULL OR workflows.template_id = $6::uuid)
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
        [identity.tenantId, payload.capabilities, payload.workflow_id ?? null, payload.agent_id, payload.worker_id ?? null, payload.template_id ?? null],
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

      const namesRes = await client.query(
        `SELECT
           w.name AS workflow_name,
           p.name AS project_name
         FROM tasks t
         LEFT JOIN workflows w ON w.tenant_id = t.tenant_id AND w.id = t.workflow_id
         LEFT JOIN projects p ON p.tenant_id = t.tenant_id AND p.id = t.project_id
         WHERE t.tenant_id = $1 AND t.id = $2`,
        [identity.tenantId, task.id],
      );
      if (namesRes.rowCount) {
        (claimedTask as Record<string, unknown>).workflow_name = namesRes.rows[0].workflow_name;
        (claimedTask as Record<string, unknown>).project_name = namesRes.rows[0].project_name;
      }

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
      const layers = (instructionContext.instruction_layers ?? {}) as Record<string, unknown>;
      const mergedBase = mergeSystemPrompt(claimedTaskBase, layers);
      if ((payload.include_context ?? true) === false) {
        return {
          ...mergedBase,
          tools: toolMatch,
          instructions,
        };
      }

      return {
        ...mergedBase,
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

    const roleName = (task.role as string) || '';
    if (!roleName) return task;

    const resolved = await this.deps.resolveRoleConfig(tenantId, roleName);
    if (!resolved) return task;

    const existingRoleConfig = (task.role_config ?? {}) as Record<string, unknown>;

    let enriched: Record<string, unknown>;
    if (resolved.provider.authMode === 'oauth' && resolved.provider.providerId) {
      enriched = await this.enrichWithOAuthCredentials(
        resolved, existingRoleConfig, task,
      );
    } else {
      enriched = this.enrichWithApiKeyCredentials(resolved, existingRoleConfig, task);
    }

    return this.enrichFromRoleDefinition(tenantId, roleName, enriched);
  }

  private async enrichFromRoleDefinition(
    tenantId: string,
    roleName: string,
    task: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    try {
      const roleRes = await this.deps.pool.query<{
        escalation_target: string | null;
        allowed_tools: string[] | null;
      }>(
        'SELECT escalation_target, allowed_tools FROM role_definitions WHERE tenant_id = $1 AND name = $2 AND is_active = true LIMIT 1',
        [tenantId, roleName],
      );
      if (!roleRes.rowCount) return task;

      const row = roleRes.rows[0];
      const existingRoleConfig = (task.role_config ?? {}) as Record<string, unknown>;
      const updates: Record<string, unknown> = {};

      if (row.escalation_target) {
        updates.escalation_target = row.escalation_target;
      }
      if (row.allowed_tools && row.allowed_tools.length > 0) {
        updates.tools = row.allowed_tools;
      }

      if (Object.keys(updates).length === 0) return task;

      return {
        ...task,
        role_config: { ...existingRoleConfig, ...updates },
      };
    } catch {
      return task;
    }
  }

  private async enrichWithOAuthCredentials(
    resolved: ResolvedRoleConfig,
    existingRoleConfig: Record<string, unknown>,
    task: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const oauthService = new OAuthService(this.deps.pool);
    const oauthToken = await oauthService.resolveValidToken(resolved.provider.providerId!);

    const llmFields: Record<string, unknown> = {
      llm_provider: resolved.provider.providerType,
      llm_model: resolved.model.modelId,
      llm_api_key: oauthToken.accessToken,
      llm_base_url: oauthToken.baseUrl,
      llm_endpoint_type: oauthToken.endpointType,
      llm_auth_mode: 'oauth',
    };

    if (Object.keys(oauthToken.extraHeaders).length > 0) {
      llmFields.llm_extra_headers = oauthToken.extraHeaders;
    }

    return {
      ...task,
      role_config: { ...existingRoleConfig, ...llmFields },
    };
  }

  private enrichWithApiKeyCredentials(
    resolved: ResolvedRoleConfig,
    existingRoleConfig: Record<string, unknown>,
    task: Record<string, unknown>,
  ): Record<string, unknown> {
    const llmFields: Record<string, unknown> = {
      llm_provider: resolved.provider.providerType,
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

function mergeSystemPrompt(
  taskResponse: Record<string, unknown>,
  instructionLayers: Record<string, unknown>,
): Record<string, unknown> {
  const flattened = flattenInstructionLayers(instructionLayers);
  if (!flattened) return taskResponse;

  const existing = (taskResponse.role_config ?? {}) as Record<string, unknown>;
  return {
    ...taskResponse,
    role_config: { ...existing, system_prompt: flattened },
  };
}
