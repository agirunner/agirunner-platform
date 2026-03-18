import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, ForbiddenError } from '../errors/domain-errors.js';
import {
  acknowledgeTaskAssignment,
  claimTaskForWorker,
  findDispatchCandidateWorkers,
  findReadyTasks,
  markWorkerBusy,
  resetExpiredDispatch,
  resetTaskClaim,
  type DispatchWorkerCandidate,
} from './worker-dispatch-repository.js';
import type { WorkerServiceContext } from './worker-service.js';

interface DispatchCandidate {
  id: string;
  status: 'online' | 'busy' | 'draining' | 'degraded' | 'disconnected' | 'offline';
  capabilities: string[];
  currentLoad: number;
}

export function selectLeastLoadedWorker(workers: DispatchCandidate[], requiredCapabilities: string[]): DispatchCandidate | null {
  const eligible = workers.filter(
    (worker) =>
      (worker.status === 'online' || worker.status === 'busy') &&
      requiredCapabilities.every((required) => worker.capabilities.includes(required)),
  );
  if (eligible.length === 0) {
    return null;
  }
  return eligible.sort((a, b) => a.currentLoad - b.currentLoad || a.id.localeCompare(b.id))[0];
}

/**
 * Selects the best worker for a task from the given candidates.
 *
 * All workers are treated equally — selection is based on load and quality
 * score (already sorted by the repository query).
 */
export function selectWorkerForDispatch(candidates: DispatchWorkerCandidate[]): string | null {
  if (candidates.length === 0) return null;
  return candidates[0].id;
}

export async function dispatchReadyTasks(context: WorkerServiceContext, limit?: number): Promise<number> {
  if (!context.connectionHub.hasConnectedWorkers()) {
    return 0;
  }

  const readyTasks = await findReadyTasks(context.pool, limit ?? context.config.WORKER_DISPATCH_BATCH_LIMIT);
  let dispatchedTasks = 0;

  for (const task of readyTasks) {
    const connectedWorkerIds = context.connectionHub.listConnectedWorkerIds(task.tenant_id);
    if (connectedWorkerIds.length === 0) {
      continue;
    }

    const candidates = await findDispatchCandidateWorkers(
      context.pool,
      task.tenant_id,
      connectedWorkerIds,
      task.capabilities_required ?? [],
    );

    const workerId = selectWorkerForDispatch(candidates);
    if (!workerId) {
      continue;
    }

    const claimedTask = await claimTaskForWorker(context.pool, task.id, task.tenant_id, workerId);
    if (!claimedTask) {
      continue;
    }

    const delivered = context.connectionHub.sendToWorker(workerId, {
      type: 'task.assigned',
      task: claimedTask,
      ack_timeout_ms: context.config.WORKER_DISPATCH_ACK_TIMEOUT_MS,
      reconnect: {
        strategy: 'exponential_backoff',
        min_ms: context.config.WORKER_RECONNECT_MIN_MS,
        max_ms: context.config.WORKER_RECONNECT_MAX_MS,
      },
    });

    if (!delivered) {
      await resetTaskClaim(context.pool, task.tenant_id, task.id);
      continue;
    }

    context.connectionHub.markDispatchPending(task.id, task.tenant_id, workerId, context.config.WORKER_DISPATCH_ACK_TIMEOUT_MS);
    await markWorkerBusy(context.pool, task.tenant_id, workerId, task.id);

    await context.eventService.emit({
      tenantId: task.tenant_id,
      type: 'task.assigned',
      entityType: 'task',
      entityId: task.id,
      actorType: 'system',
      actorId: 'dispatcher',
      data: { worker_id: workerId, workflow_id: claimedTask.workflow_id, workspace_id: claimedTask.workspace_id },
    });

    dispatchedTasks += 1;
  }

  return dispatchedTasks;
}

export async function acknowledgeTask(
  context: WorkerServiceContext,
  workerIdentity: ApiKeyIdentity,
  taskId: string,
  agentId?: string,
): Promise<void> {
  if (workerIdentity.scope !== 'worker' || !workerIdentity.ownerId) {
    throw new ForbiddenError('Worker identity required');
  }

  const acknowledged = await acknowledgeTaskAssignment(
    context.pool,
    workerIdentity.tenantId,
    taskId,
    workerIdentity.ownerId,
    agentId,
  );
  if (!acknowledged) {
    throw new ConflictError('Task is not currently assigned to this worker');
  }

  context.connectionHub.acknowledgeDispatch(taskId);
}

interface ModelAssignmentInfo {
  role_name: string;
  primary_model_id: string | null;
  primary_model_external_id: string | null;
}

/**
 * Resolves model assignments for a role from the database.
 * Returns null if no assignment exists for the given role.
 */
export async function resolveModelForRole(
  pool: DatabasePool,
  tenantId: string,
  roleName: string,
): Promise<ModelAssignmentInfo | null> {
  const result = await pool.query<ModelAssignmentInfo>(
    `SELECT rma.role_name, rma.primary_model_id,
            pm.model_id AS primary_model_external_id
     FROM role_model_assignments rma
     LEFT JOIN llm_models pm ON pm.id = rma.primary_model_id
     WHERE rma.tenant_id = $1 AND rma.role_name = $2`,
    [tenantId, roleName],
  );
  return result.rows[0] ?? null;
}

export async function releaseExpiredDispatches(context: WorkerServiceContext): Promise<number> {
  let releasedCount = 0;

  for (const dispatch of context.connectionHub.listExpiredDispatches()) {
    const releasedTask = await resetExpiredDispatch(context.pool, dispatch);
    if (!releasedTask) {
      continue;
    }

    await context.eventService.emit({
      tenantId: dispatch.tenantId,
      type: 'task.dispatch_timeout',
      entityType: 'task',
      entityId: dispatch.taskId,
      actorType: 'system',
      actorId: 'dispatcher',
      data: { worker_id: dispatch.workerId, workflow_id: releasedTask.workflow_id, workspace_id: releasedTask.workspace_id },
    });

    releasedCount += 1;
  }

  return releasedCount;
}
