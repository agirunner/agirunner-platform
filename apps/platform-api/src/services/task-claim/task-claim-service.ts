import type { ApiKeyIdentity } from '../../auth/api-key.js';
import { AgentBusyError, ForbiddenError, NotFoundError } from '../../errors/domain-errors.js';
import { readOAuthToken, readProviderSecret } from '../../lib/oauth-crypto.js';
import { assertValidTransition, normalizeTaskState } from '../../orchestration/task-state-machine.js';
import {
  computeToolMatch,
  readAgentToolRequirements,
  resolveWorkspaceToolTags,
} from '../tool-tag-service.js';
import {
  buildExecutionModeCondition,
  readAgentExecutionMode,
} from './task-claim-common.js';
import {
  parseClaimCredentialHandlePayload,
  parseExtraHeadersSecret,
  parseMcpClaimCredentialHandle,
  mapClaimCredentialResolutionError,
} from './task-claim-credential-handles.js';
import {
  assertIdentityOwnsTask,
  assertClaimTransitionReady,
  promoteRetryReadyTasks,
  reclaimOwnedAgentTask,
  resolveExecutionEnvironmentContract,
  resolveTaskLoopContract,
  shouldYieldOrchestratorClaim,
} from './task-claim-db-operations.js';
import {
  buildClaimResponse,
  resolveTaskLLMConfig,
} from './task-claim-response.js';
import { priorityCase } from './task-claim-constants.js';
import type { TaskClaimDependencies, TaskClaimPayload } from './task-claim-types.js';
import { matchesWorkerToTaskRouting } from '../task/task-routing-contract.js';

export class TaskClaimService {
  constructor(private readonly deps: TaskClaimDependencies) {}

  async claimTask(
    identity: ApiKeyIdentity,
    payload: TaskClaimPayload,
  ): Promise<Record<string, unknown> | null> {
    const client = await this.deps.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await promoteRetryReadyTasks(this.deps, identity.tenantId, payload.workflow_id, client);

      const agentRes = await client.query('SELECT * FROM agents WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [
        identity.tenantId,
        payload.agent_id,
      ]);
      if (!agentRes.rowCount) throw new NotFoundError('Agent not found');

      const agent = agentRes.rows[0];
      const executionMode = readAgentExecutionMode(agent.metadata);
      if (identity.scope === 'worker') {
        if (!identity.ownerId) {
          throw new ForbiddenError('Agent identity is not bound to a Specialist Agent owner.');
        }

        if (agent.worker_id !== identity.ownerId) {
          throw new ForbiddenError('Specialist Agent cannot claim tasks with a Specialist Execution owned by a different Specialist Agent.');
        }

        if (payload.worker_id && payload.worker_id !== identity.ownerId) {
          throw new ForbiddenError('Specialist Agent cannot claim tasks on behalf of a different Specialist Agent.');
        }
      }

      if (payload.worker_id && agent.worker_id !== payload.worker_id) {
        throw new ForbiddenError('Specialist Agent cannot claim tasks with a Specialist Execution owned by a different Specialist Agent.');
      }

      if (agent.current_task_id) {
        const ownedTask = await reclaimOwnedAgentTask(
          identity.tenantId,
          payload.agent_id,
          agent,
          client,
        );
        if (ownedTask) {
          const agentTools = readAgentToolRequirements(agent);
          const workspaceTools = await resolveWorkspaceToolTags(
            client,
            identity.tenantId,
            (ownedTask.workspace_id as string | null | undefined) ?? null,
          );
          const evaluation = computeToolMatch(workspaceTools, agentTools);
          const llmResolution = await resolveTaskLLMConfig(this.deps, identity.tenantId, ownedTask);
          const loopContract = await resolveTaskLoopContract(
            identity.tenantId,
            ownedTask,
            client,
          );
          const resolvedExecutionEnvironment = await resolveExecutionEnvironmentContract(
            identity.tenantId,
            ownedTask,
            client,
          );
          await client.query(
            `UPDATE agents SET current_task_id = $2, status = 'busy', last_heartbeat_at = now()
                , last_claim_at = now()
             WHERE tenant_id = $1 AND id = $3`,
            [identity.tenantId, ownedTask.id, payload.agent_id],
          );
          const claimResponse = await buildClaimResponse(this.deps, {
            identity,
            payload,
            task: ownedTask,
            llmResolution,
            loopContract,
            resolvedExecutionEnvironment,
            toolMatch: {
              matched: evaluation.matched,
              unavailable_optional: evaluation.unavailable_optional,
            },
            client,
          });
          await client.query('COMMIT');
          committed = true;
          return claimResponse;
        }
        if (!agent.current_task_id) {
          agent.current_task_id = null;
        }
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
           AND ($2::uuid IS NULL OR tasks.workflow_id = $2::uuid)
           AND ($5::uuid IS NULL OR workflows.playbook_id = $5::uuid)
           AND ${buildExecutionModeCondition(executionMode)}
           AND (
             workflows.id IS NULL
             OR (
               workflows.state NOT IN ('paused', 'cancelled', 'completed', 'failed')
               AND COALESCE(NULLIF(workflows.metadata->>'pause_requested_at', ''), '') = ''
               AND COALESCE(NULLIF(workflows.metadata->>'cancel_requested_at', ''), '') = ''
             )
           )
           AND (
             NOT (tasks.metadata ? 'preferred_agent_id')
             OR NULLIF(tasks.metadata->>'preferred_agent_id', '') IS NULL
             OR tasks.metadata->>'preferred_agent_id' = $3
           )
           AND (
             NOT (tasks.metadata ? 'preferred_worker_id')
             OR NULLIF(tasks.metadata->>'preferred_worker_id', '') IS NULL
             OR tasks.metadata->>'preferred_worker_id' = COALESCE($4, tasks.metadata->>'preferred_worker_id')
           )
         ORDER BY
           CASE WHEN tasks.metadata->>'preferred_agent_id' = $3 THEN 1 ELSE 0 END DESC,
           CASE WHEN tasks.metadata->>'preferred_worker_id' = COALESCE($4, tasks.metadata->>'preferred_worker_id') THEN 1 ELSE 0 END DESC,
           ${priorityCase} DESC,
           tasks.created_at ASC
         LIMIT 25
         FOR UPDATE OF tasks SKIP LOCKED`,
        [identity.tenantId, payload.workflow_id ?? null, payload.agent_id, payload.worker_id ?? null, payload.playbook_id ?? null],
      );

      if (!taskRes.rowCount) {
        await client.query('COMMIT');
        return null;
      }

      const agentTools = readAgentToolRequirements(agent);
      let task: Record<string, unknown> | null = null;
      let toolMatch = { matched: [] as string[], unavailable_optional: [] as string[] };
      const routingTags = payload.routing_tags ?? [];
      for (const candidate of taskRes.rows as Record<string, unknown>[]) {
        if (!matchesWorkerToTaskRouting(candidate, routingTags)) {
          continue;
        }
        if (
          this.deps.parallelismService &&
          (await this.deps.parallelismService.shouldQueueForCapacity(
            identity.tenantId,
            {
              taskId: String(candidate.id),
              workflowId:
                typeof candidate.workflow_id === 'string' ? candidate.workflow_id : null,
              workItemId:
                typeof candidate.work_item_id === 'string' ? candidate.work_item_id : null,
              isOrchestratorTask: candidate.is_orchestrator_task === true,
              currentState:
                typeof candidate.state === 'string' ? normalizeTaskState(candidate.state) : null,
            },
            client,
          ))
        ) {
          continue;
        }
        const workspaceTools = await resolveWorkspaceToolTags(
          client,
          identity.tenantId,
          (candidate.workspace_id as string | null | undefined) ?? null,
        );
        const evaluation = computeToolMatch(workspaceTools, agentTools);
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
      if (
        task.is_orchestrator_task === true
        && await shouldYieldOrchestratorClaim({
          tenantId: identity.tenantId,
          task,
          agent,
          agentId: payload.agent_id,
          playbookId:
            typeof payload.playbook_id === 'string' && payload.playbook_id.trim().length > 0
              ? payload.playbook_id.trim()
              : null,
          client,
        })
      ) {
        await client.query('COMMIT');
        return null;
      }
      const llmResolution = await resolveTaskLLMConfig(this.deps, identity.tenantId, task);
      const loopContract = await resolveTaskLoopContract(
        identity.tenantId,
        task,
        client,
      );
      const resolvedExecutionEnvironment = await resolveExecutionEnvironmentContract(
        identity.tenantId,
        task,
        client,
      );
      const executionContainer = resolvedExecutionEnvironment?.executionContainer ?? null;
      const executionEnvironment = resolvedExecutionEnvironment?.executionEnvironment ?? null;
      if (
        executionContainer
        && this.deps.executionContainerLeaseService
      ) {
        const lease = await this.deps.executionContainerLeaseService.reserveForTask(
          identity.tenantId,
          {
            taskId: String(task.id),
            workflowId:
              typeof task.workflow_id === 'string' && task.workflow_id.trim().length > 0
                ? task.workflow_id
                : null,
            workItemId:
              typeof task.work_item_id === 'string' && task.work_item_id.trim().length > 0
                ? task.work_item_id
                : null,
            role: typeof task.role === 'string' ? task.role : '',
            agentId: payload.agent_id,
            workerId: payload.worker_id ?? null,
          },
          client,
        );
        if (!lease.reserved) {
          await client.query('COMMIT');
          return null;
        }
      }
      assertClaimTransitionReady(task);

      const updatedTaskRes = await client.query(
        `UPDATE tasks
         SET state = 'claimed', state_changed_at = now(),
             assigned_agent_id = $3,
             assigned_worker_id = $4,
             claimed_at = now(),
             execution_environment_id = $5,
             execution_environment_snapshot = $6::jsonb
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          identity.tenantId,
          task.id,
          payload.agent_id,
          payload.worker_id ?? null,
          executionEnvironment?.id ?? null,
          JSON.stringify(resolvedExecutionEnvironment?.snapshot ?? null),
        ],
      );

      await client.query(
        `UPDATE agents SET current_task_id = $2, status = 'busy', last_heartbeat_at = now()
            , last_claim_at = now()
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

      const claimResponse = await buildClaimResponse(this.deps, {
        identity,
        payload,
        task: updatedTaskRes.rows[0] as Record<string, unknown>,
        llmResolution,
        loopContract,
        resolvedExecutionEnvironment,
        toolMatch,
        client,
      });
      await client.query('COMMIT');
      committed = true;
      return claimResponse;
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveClaimCredentials(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      llm_api_key_claim_handle?: string;
      llm_extra_headers_claim_handle?: string;
      mcp_claim_handles?: string[];
    },
  ): Promise<Record<string, unknown>> {
    if (!identity.ownerId?.trim()) {
      throw new ForbiddenError('Calling identity is not bound to a Specialist Agent or Specialist Execution owner.');
    }

    await assertIdentityOwnsTask(this.deps, identity, taskId);

    const credentials: Record<string, unknown> = {};
    if (payload.llm_api_key_claim_handle) {
      const claim = parseClaimCredentialHandlePayload(
        payload.llm_api_key_claim_handle,
        taskId,
        'llm_api_key',
        this.deps.claimHandleSecret,
      );
      try {
        credentials.llm_api_key = readOAuthToken(claim.stored_secret);
      } catch (error) {
        throw mapClaimCredentialResolutionError(error);
      }
    }
    if (payload.llm_extra_headers_claim_handle) {
      const claim = parseClaimCredentialHandlePayload(
        payload.llm_extra_headers_claim_handle,
        taskId,
        'llm_extra_headers',
        this.deps.claimHandleSecret,
      );
      try {
        credentials.llm_extra_headers = parseExtraHeadersSecret(claim.stored_secret);
      } catch (error) {
        throw mapClaimCredentialResolutionError(error);
      }
    }
    if (Array.isArray(payload.mcp_claim_handles) && payload.mcp_claim_handles.length > 0) {
      credentials.mcp_claim_values = Object.fromEntries(
        payload.mcp_claim_handles.map((handle) => [
          handle,
          readProviderSecret(
            parseMcpClaimCredentialHandle(
              handle,
              taskId,
              this.deps.claimHandleSecret,
            ),
          ),
        ]),
      );
    }
    return credentials;
  }
}
