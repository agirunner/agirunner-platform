import type { FastifyBaseLogger } from 'fastify';
import type { DatabasePool } from '../db/database.js';

import type { AppEnv } from '../config/schema.js';
import { AgentService } from '../services/agent-service.js';
import { FleetService } from '../services/fleet-service/fleet-service.js';
import { GovernanceService } from '../services/governance-service.js';
import { readLifecycleMonitorTimingDefaults } from '../services/platform-timing-defaults.js';
import { TaskService } from '../services/task-service.js';
import { WorkerService } from '../services/workers/worker-service.js';
import { WorkflowActivationDispatchService } from '../services/workflow-activation-dispatch-service.js';

export interface LifecycleMonitor {
  stop: () => void;
}

interface LifecycleTimingResolver {
  resolve: () => Promise<number>;
}

export async function runAgentHeartbeatTick(
  logger: FastifyBaseLogger,
  agentService: AgentService,
): Promise<number> {
  const affected = await agentService.enforceHeartbeatTimeouts();
  if (affected > 0) {
    logger.info({ affected }, 'heartbeat_timeout_enforced');
  }
  return affected;
}

export async function runWorkerHeartbeatTick(
  logger: FastifyBaseLogger,
  workerService: WorkerService,
): Promise<number> {
  const affected = await workerService.enforceHeartbeatTimeouts();
  if (affected > 0) {
    logger.info({ affected }, 'worker_heartbeat_timeout_enforced');
  }
  return affected;
}

export async function runTaskTimeoutTick(
  logger: FastifyBaseLogger,
  taskService: TaskService,
): Promise<{ timedOut: number; cancelled: number }> {
  const [timedOut, cancelled] = await Promise.all([
    taskService.failTimedOutTasks(),
    taskService.finalizeGracefulWorkflowCancellations(),
  ]);
  if (timedOut > 0) {
    logger.info({ affected: timedOut }, 'task_timeout_enforced');
  }
  if (cancelled > 0) {
    logger.info({ affected: cancelled }, 'workflow_cancellation_enforced');
  }
  return { timedOut, cancelled };
}

export async function runWorkerDispatchTick(workerService: WorkerService): Promise<void> {
  await workerService.releaseExpiredDispatches();
  await workerService.dispatchReadyTasks();
}

export async function runWorkflowActivationDispatchTick(
  logger: FastifyBaseLogger,
  workflowActivationDispatchService?: WorkflowActivationDispatchService,
): Promise<void> {
  if (!workflowActivationDispatchService) {
    return;
  }
  const recovery = await workflowActivationDispatchService.recoverStaleActivations();
  if (recovery.requeued > 0 || recovery.redispatched > 0 || recovery.reported > 0) {
    logger.info(
      {
        requeued: recovery.requeued,
        redispatched: recovery.redispatched,
        reported: recovery.reported,
        details: recovery.details,
      },
      'workflow_activation_recovery_enforced',
    );
  }
  const heartbeats = await workflowActivationDispatchService.enqueueHeartbeatActivations();
  if (heartbeats > 0) {
    logger.debug({ enqueued: heartbeats }, 'workflow_activation_heartbeats_enqueued');
  }
  await workflowActivationDispatchService.dispatchQueuedActivations();
}

export async function runDispatchTick(
  logger: FastifyBaseLogger,
  workerService: WorkerService,
  workflowActivationDispatchService?: WorkflowActivationDispatchService,
): Promise<void> {
  await runWorkerDispatchTick(workerService);
  await runWorkflowActivationDispatchTick(logger, workflowActivationDispatchService);
}

export async function runHeartbeatPruneTick(
  logger: FastifyBaseLogger,
  fleetService?: FleetService,
): Promise<number> {
  if (!fleetService) {
    return 0;
  }
  const pruned = await fleetService.pruneStaleHeartbeats();
  if (pruned > 0) {
    logger.debug({ pruned }, 'stale_heartbeats_pruned');
  }
  return pruned;
}

export async function runGovernanceRetentionTick(
  logger: FastifyBaseLogger,
  governanceService?: GovernanceService,
): Promise<void> {
  if (!governanceService) {
    return;
  }
  const result = await governanceService.enforceRetentionPolicies();
  if (result.prunedTasks > 0 || result.deletedWorkflows > 0 || result.droppedLogPartitions > 0) {
    logger.info(result, 'governance_retention_enforced');
  }
}

export function startLifecycleMonitor(
  logger: FastifyBaseLogger,
  pool: DatabasePool,
  config: AppEnv,
  agentService: AgentService,
  taskService: TaskService,
  workerService: WorkerService,
  workflowActivationDispatchService?: WorkflowActivationDispatchService,
  fleetService?: FleetService,
  governanceService?: GovernanceService,
): LifecycleMonitor {
  const readTimingDefaults = () => readLifecycleMonitorTimingDefaults(pool);
  const stopHeartbeatLoop = startRecurringLoop(
    { resolve: async () => (await readTimingDefaults()).agentHeartbeatIntervalMs },
    async () => {
      try {
        await runAgentHeartbeatTick(logger, agentService);
      } catch (error) {
        logger.error({ err: error }, 'heartbeat_monitor_failed');
      }
    },
  );
  const stopWorkerHeartbeatLoop = startRecurringLoop(
    { resolve: async () => (await readTimingDefaults()).workerHeartbeatIntervalMs },
    async () => {
      try {
        await runWorkerHeartbeatTick(logger, workerService);
      } catch (error) {
        logger.error({ err: error }, 'worker_heartbeat_monitor_failed');
      }
    },
  );
  const stopTimeoutLoop = startRecurringLoop(
    { resolve: async () => (await readTimingDefaults()).taskTimeoutIntervalMs },
    async () => {
      try {
        await runTaskTimeoutTick(logger, taskService);
      } catch (error) {
        logger.error({ err: error }, 'task_timeout_monitor_failed');
      }
    },
  );
  const stopDispatchLoop = startRecurringLoop(
    { resolve: async () => (await readTimingDefaults()).dispatchLoopIntervalMs },
    async () => {
      try {
        await runDispatchTick(logger, workerService, workflowActivationDispatchService);
      } catch (error) {
        logger.error({ err: error }, 'worker_dispatch_monitor_failed');
      }
    },
  );
  const stopHeartbeatPruneLoop = startRecurringLoop(
    { resolve: async () => (await readTimingDefaults()).heartbeatPruneIntervalMs },
    async () => {
      try {
        await runHeartbeatPruneTick(logger, fleetService);
      } catch (error) {
        logger.error({ err: error }, 'heartbeat_prune_failed');
      }
    },
  );
  const stopRetentionLoop = startRecurringLoop(
    { resolve: async () => (await readTimingDefaults()).governanceRetentionIntervalMs },
    async () => {
      try {
        await runGovernanceRetentionTick(logger, governanceService);
      } catch (error) {
        logger.error({ err: error }, 'governance_retention_monitor_failed');
      }
    },
  );

  return {
    stop: () => {
      stopHeartbeatLoop();
      stopWorkerHeartbeatLoop();
      stopTimeoutLoop();
      stopDispatchLoop();
      stopHeartbeatPruneLoop();
      stopRetentionLoop();
    },
  };
}

function startRecurringLoop(
  timing: LifecycleTimingResolver,
  runOnce: () => Promise<void>,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const scheduleNext = async () => {
    if (stopped) {
      return;
    }
    const intervalMs = await timing.resolve();
    timer = setTimeout(async () => {
      try {
        await runOnce();
      } finally {
        await scheduleNext();
      }
    }, intervalMs);
  };

  void scheduleNext();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}
