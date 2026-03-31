import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors/domain-errors.js';
import { matchesWorkerToTaskRouting } from '../task/task-routing-contract.js';
import { assertValidTransition } from '../../orchestration/task-state-machine.js';
import { readAgentSupervisionTimingDefaults } from '../platform-config/platform-timing-defaults.js';
import {
  readPositiveInteger,
  readRequiredPositiveIntegerRuntimeDefault,
} from '../runtime-defaults/runtime-default-values.js';
import { buildResolvedTaskExecutionEnvironment, readTaskExecutionBackend } from './task-claim-task-payload.js';
import { priorityCase } from './task-claim-constants.js';
import {
  agentCanClaimOrchestratorTasks,
  isFreshClaimPeer,
  normalizeAgentPlaybookScope,
  toNullableDate,
} from './task-claim-common.js';
import type {
  ClaimPeerAgentRow,
  ClaimableExecutionEnvironmentRow,
  ResolvedTaskExecutionEnvironment,
  RetryReadyTaskRow,
  TaskClaimDependencies,
  TaskLoopContract,
} from './task-claim-types.js';

export async function promoteRetryReadyTasks(
  deps: TaskClaimDependencies,
  tenantId: string,
  workflowId: string | undefined,
  client: DatabaseClient,
): Promise<void> {
  const candidates = await client.query<RetryReadyTaskRow>(
    `SELECT id, workflow_id, work_item_id, is_orchestrator_task, state
         FROM tasks
        WHERE tenant_id = $1
          AND state = 'pending'
          AND metadata ? 'retry_available_at'
          AND ($2::uuid IS NULL OR workflow_id = $2::uuid)
          AND (metadata->>'retry_available_at')::timestamptz <= now()
        ORDER BY ${priorityCase} DESC, created_at ASC
        FOR UPDATE SKIP LOCKED`,
    [tenantId, workflowId ?? null],
  );

  for (const candidate of candidates.rows) {
    const shouldQueue =
      deps.parallelismService &&
      (await deps.parallelismService.shouldQueueForCapacity(
        tenantId,
        {
          taskId: candidate.id,
          workflowId: candidate.workflow_id,
          workItemId: candidate.work_item_id,
          isOrchestratorTask: candidate.is_orchestrator_task,
          currentState: candidate.state,
        },
        client,
      ));
    if (shouldQueue) {
      continue;
    }

    const updated = await client.query(
      `UPDATE tasks
            SET state = 'ready',
                state_changed_at = now()
          WHERE tenant_id = $1
            AND id = $2
            AND state = 'pending'`,
      [tenantId, candidate.id],
    );
    if (!updated.rowCount) {
      continue;
    }

    await deps.eventService.emit(
      {
        tenantId,
        type: 'task.state_changed',
        entityType: 'task',
        entityId: candidate.id,
        actorType: 'system',
        actorId: 'retry_backoff',
        data: {
          from_state: 'pending',
          to_state: 'ready',
          reason: 'retry_backoff_elapsed',
        },
      },
      client,
    );
  }
}

export async function shouldYieldOrchestratorClaim(input: {
  tenantId: string;
  task: Record<string, unknown>;
  agent: Record<string, unknown>;
  agentId: string;
  playbookId: string | null;
  client: DatabaseClient;
}): Promise<boolean> {
  const scopePlaybookId = normalizeAgentPlaybookScope(input.playbookId, input.agent.metadata);
  const timingDefaults = await readAgentSupervisionTimingDefaults(input.client, input.tenantId);
  const peerAgents = await input.client.query<ClaimPeerAgentRow>(
    `SELECT id, routing_tags, last_claim_at, last_heartbeat_at, heartbeat_interval_seconds, metadata
         FROM agents
        WHERE tenant_id = $1
          AND id <> $2
          AND current_task_id IS NULL
          AND status IN ('active', 'idle')`,
    [input.tenantId, input.agentId],
  );
  const eligiblePeers = peerAgents.rows.filter((peer) => {
    if (!agentCanClaimOrchestratorTasks(peer.metadata)) {
      return false;
    }
    if (normalizeAgentPlaybookScope(null, peer.metadata) !== scopePlaybookId) {
      return false;
    }
    if (!isFreshClaimPeer(peer, timingDefaults.heartbeatThresholdMultiplier)) {
      return false;
    }
    return matchesWorkerToTaskRouting(
      input.task,
      Array.isArray(peer.routing_tags) ? peer.routing_tags : [],
    );
  });
  if (eligiblePeers.length === 0) {
    return false;
  }

  const currentLastClaimAt = toNullableDate(input.agent.last_claim_at);
  if (currentLastClaimAt == null) {
    return false;
  }
  if (eligiblePeers.some((peer) => toNullableDate(peer.last_claim_at) == null)) {
    return true;
  }

  const oldestPeerClaimAt = eligiblePeers
    .map((peer) => toNullableDate(peer.last_claim_at))
    .filter((value): value is Date => value instanceof Date)
    .sort((left, right) => left.getTime() - right.getTime())[0];
  if (!oldestPeerClaimAt) {
    return false;
  }
  return currentLastClaimAt.getTime() > oldestPeerClaimAt.getTime();
}

export async function reclaimOwnedAgentTask(
  tenantId: string,
  agentId: string,
  agent: Record<string, unknown>,
  client: DatabaseClient,
): Promise<Record<string, unknown> | null> {
  const currentTaskId =
    typeof agent.current_task_id === 'string' && agent.current_task_id.trim().length > 0
      ? agent.current_task_id.trim()
      : null;
  if (!currentTaskId) {
    return null;
  }

  const taskResult = await client.query<Record<string, unknown>>(
    `SELECT *
         FROM tasks
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
    [tenantId, currentTaskId],
  );
  const activeTask = taskResult.rows[0];
  const expectedWorkerId =
    typeof agent.worker_id === 'string' && agent.worker_id.trim().length > 0
      ? agent.worker_id.trim()
      : null;
  const stillBusy =
    !!activeTask
    && (activeTask.state === 'claimed' || activeTask.state === 'in_progress')
    && activeTask.assigned_agent_id === agentId
    && (expectedWorkerId == null || activeTask.assigned_worker_id === expectedWorkerId);
  if (stillBusy) {
    return activeTask;
  }

  await client.query(
    `UPDATE agents
          SET current_task_id = NULL,
              status = (CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'active' END)::agent_status,
              last_heartbeat_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
    [tenantId, agentId],
  );
  agent.current_task_id = null;
  return null;
}

export async function resolveTaskLoopContract(
  tenantId: string,
  task: Record<string, unknown>,
  db: DatabaseClient,
): Promise<TaskLoopContract> {
  const maxIterations = await resolveLoopContractValue(
    tenantId,
    task.max_iterations,
    'agent.max_iterations',
    db,
  );
  const llmMaxRetries = await resolveLoopContractValue(
    tenantId,
    task.llm_max_retries,
    'agent.llm_max_retries',
    db,
  );
  return {
    loopMode: task.is_orchestrator_task === true ? 'tpaov' : 'reactive',
    maxIterations,
    llmMaxRetries,
  };
}

export async function resolveExecutionEnvironmentContract(
  tenantId: string,
  task: Record<string, unknown>,
  db: DatabaseClient,
): Promise<ResolvedTaskExecutionEnvironment | null> {
  if (readTaskExecutionBackend(task) !== 'runtime_plus_task') {
    return null;
  }
  const environmentId = await readRoleScopedExecutionEnvironmentId(
    tenantId,
    typeof task.role === 'string' ? task.role : '',
    db,
  );
  const row = await readClaimableExecutionEnvironmentRow(tenantId, environmentId, db);
  if (!row) {
    throw new ValidationError(
      'No claimable Specialist Execution environment is configured for this role or tenant default',
    );
  }
  return buildResolvedTaskExecutionEnvironment(row);
}

export async function assertIdentityOwnsTask(
  deps: TaskClaimDependencies,
  identity: ApiKeyIdentity,
  taskId: string,
): Promise<void> {
  const result = await deps.pool.query<{ assigned_agent_id: string | null; assigned_worker_id: string | null }>(
    `SELECT assigned_agent_id, assigned_worker_id
         FROM tasks
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
    [identity.tenantId, taskId],
  );
  if (!result.rowCount) {
    throw new NotFoundError('Task not found');
  }

  const task = result.rows[0];
  if (identity.scope === 'worker') {
    if ((task?.assigned_worker_id ?? '') !== identity.ownerId) {
      throw new ForbiddenError('Specialist Agent cannot resolve claim credentials for a different task.');
    }
    return;
  }

  if ((task?.assigned_agent_id ?? '') !== identity.ownerId) {
    throw new ForbiddenError('Agent cannot resolve claim credentials for a different task.');
  }
}

function assertTaskTransition(task: Record<string, unknown>): void {
  assertValidTransition(
    task.id as string,
    task.state as Parameters<typeof assertValidTransition>[1],
    'claimed',
  );
}

export function assertClaimTransitionReady(task: Record<string, unknown>): void {
  assertTaskTransition(task);
}

async function readRoleScopedExecutionEnvironmentId(
  tenantId: string,
  roleName: string,
  db: DatabaseClient,
): Promise<string | null> {
  const trimmedRoleName = roleName.trim();
  if (trimmedRoleName.length === 0) {
    return null;
  }
  const result = await db.query<{ execution_environment_id: string | null }>(
    `SELECT execution_environment_id
         FROM role_definitions
        WHERE tenant_id = $1
          AND name = $2
          AND is_active = true
        LIMIT 1`,
    [tenantId, trimmedRoleName],
  );
  return result.rows[0]?.execution_environment_id ?? null;
}

async function readClaimableExecutionEnvironmentRow(
  tenantId: string,
  requestedId: string | null,
  db: DatabaseClient,
): Promise<ClaimableExecutionEnvironmentRow | null> {
  const result = await db.query<ClaimableExecutionEnvironmentRow>(
    `SELECT
         ee.id,
         ee.name,
         ee.source_kind,
         ee.catalog_key,
         ee.catalog_version,
         ee.image,
         ee.cpu,
         ee.memory,
         ee.pull_policy,
         ee.compatibility_status,
         ee.verification_contract_version,
         ee.verified_metadata,
         ee.tool_capabilities,
         ee.bootstrap_commands,
         ee.bootstrap_required_domains,
         c.support_status
       FROM execution_environments ee
       LEFT JOIN execution_environment_catalog c
         ON c.catalog_key = ee.catalog_key
        AND c.catalog_version = ee.catalog_version
      WHERE ee.tenant_id = $1
        AND ee.is_archived = false
        AND ee.is_claimable = true
        AND COALESCE(c.support_status, 'active') <> 'blocked'
        AND (
          ($2::uuid IS NOT NULL AND ee.id = $2::uuid)
          OR ($2::uuid IS NULL AND ee.is_default = true)
        )
      LIMIT 1`,
    [tenantId, requestedId],
  );
  return result.rows[0] ?? null;
}

async function resolveLoopContractValue(
  tenantId: string,
  explicitValue: unknown,
  runtimeDefaultKey: 'agent.max_iterations' | 'agent.llm_max_retries',
  db: DatabaseClient,
): Promise<number> {
  const directValue = readPositiveInteger(explicitValue);
  if (directValue !== null) {
    return directValue;
  }

  return readRequiredPositiveIntegerRuntimeDefault(db, tenantId, runtimeDefaultKey);
}
