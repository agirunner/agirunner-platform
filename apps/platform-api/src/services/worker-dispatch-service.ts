import type { ApiKeyIdentity } from '../auth/api-key.js';
import { ConflictError, ForbiddenError } from '../errors/domain-errors.js';
import {
  acknowledgeTaskAssignment,
  claimTaskForWorker,
  findDispatchCandidateWorker,
  findReadyTasks,
  markWorkerBusy,
  resetExpiredDispatch,
  resetTaskClaim,
} from './worker-dispatch-repository.js';
import type { WorkerServiceContext } from './worker-service.js';

interface DispatchCandidate {
  id: string;
  status: 'online' | 'busy' | 'draining' | 'degraded' | 'offline';
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

export async function dispatchReadyTasks(context: WorkerServiceContext, limit?: number): Promise<number> {
  const readyTasks = await findReadyTasks(context.pool, limit ?? context.config.WORKER_DISPATCH_BATCH_LIMIT);
  let dispatchedTasks = 0;

  for (const task of readyTasks) {
    const connectedWorkerIds = context.connectionHub.listConnectedWorkerIds(task.tenant_id);
    if (connectedWorkerIds.length === 0) {
      continue;
    }

    const workerId = await findDispatchCandidateWorker(
      context.pool,
      task.tenant_id,
      connectedWorkerIds,
      task.capabilities_required ?? [],
    );
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
      data: { worker_id: workerId, pipeline_id: claimedTask.pipeline_id, project_id: claimedTask.project_id },
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
      data: { worker_id: dispatch.workerId, pipeline_id: releasedTask.pipeline_id, project_id: releasedTask.project_id },
    });

    releasedCount += 1;
  }

  return releasedCount;
}
