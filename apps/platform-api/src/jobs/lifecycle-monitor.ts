import type { FastifyBaseLogger } from 'fastify';

import type { AppEnv } from '../config/schema.js';
import { AgentService } from '../services/agent-service.js';
import { FleetService } from '../services/fleet-service.js';
import { GovernanceService } from '../services/governance-service.js';
import { ScheduledWorkItemTriggerService } from '../services/scheduled-work-item-trigger-service.js';
import { TaskService } from '../services/task-service.js';
import { WorkerService } from '../services/worker-service.js';
import { WorkflowActivationDispatchService } from '../services/workflow-activation-dispatch-service.js';

export interface LifecycleMonitor {
  stop: () => void;
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
  scheduledWorkItemTriggerService?: ScheduledWorkItemTriggerService,
): Promise<void> {
  if (scheduledWorkItemTriggerService) {
    const scheduled = await scheduledWorkItemTriggerService.fireDueTriggers();
    if (scheduled.claimed > 0 || scheduled.fired > 0 || scheduled.duplicates > 0 || scheduled.failed > 0) {
      logger.info(scheduled, 'scheduled_work_item_triggers_processed');
    }
  }
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
  await workflowActivationDispatchService.dispatchQueuedActivations();
}

export async function runDispatchTick(
  logger: FastifyBaseLogger,
  workerService: WorkerService,
  workflowActivationDispatchService?: WorkflowActivationDispatchService,
  scheduledWorkItemTriggerService?: ScheduledWorkItemTriggerService,
): Promise<void> {
  await runWorkerDispatchTick(workerService);
  await runWorkflowActivationDispatchTick(
    logger,
    workflowActivationDispatchService,
    scheduledWorkItemTriggerService,
  );
}

export async function runHeartbeatPruneTick(
  logger: FastifyBaseLogger,
  fleetService?: FleetService,
): Promise<number> {
  if (!fleetService) {
    return 0;
  }
  const pruned = await fleetService.pruneStaleHeartbeats(10);
  if (pruned > 0) {
    logger.info({ pruned }, 'stale_heartbeats_pruned');
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
  if (result.archivedTasks > 0 || result.deletedTasks > 0 || result.droppedLogPartitions > 0) {
    logger.info(result, 'governance_retention_enforced');
  }
}

export function startLifecycleMonitor(
  logger: FastifyBaseLogger,
  config: AppEnv,
  agentService: AgentService,
  taskService: TaskService,
  workerService: WorkerService,
  workflowActivationDispatchService?: WorkflowActivationDispatchService,
  scheduledWorkItemTriggerService?: ScheduledWorkItemTriggerService,
  fleetService?: FleetService,
  governanceService?: GovernanceService,
): LifecycleMonitor {
  const heartbeatTimer = setInterval(async () => {
    try {
      await runAgentHeartbeatTick(logger, agentService);
    } catch (error) {
      logger.error({ err: error }, 'heartbeat_monitor_failed');
    }
  }, config.LIFECYCLE_AGENT_HEARTBEAT_CHECK_INTERVAL_MS);

  const workerHeartbeatTimer = setInterval(async () => {
    try {
      await runWorkerHeartbeatTick(logger, workerService);
    } catch (error) {
      logger.error({ err: error }, 'worker_heartbeat_monitor_failed');
    }
  }, config.LIFECYCLE_WORKER_HEARTBEAT_CHECK_INTERVAL_MS);

  const timeoutTimer = setInterval(async () => {
    try {
      await runTaskTimeoutTick(logger, taskService);
    } catch (error) {
      logger.error({ err: error }, 'task_timeout_monitor_failed');
    }
  }, config.LIFECYCLE_TASK_TIMEOUT_CHECK_INTERVAL_MS);

  const dispatchTimer = setInterval(async () => {
    try {
      await runDispatchTick(
        logger,
        workerService,
        workflowActivationDispatchService,
        scheduledWorkItemTriggerService,
      );
    } catch (error) {
      logger.error({ err: error }, 'worker_dispatch_monitor_failed');
    }
  }, config.LIFECYCLE_DISPATCH_LOOP_INTERVAL_MS);

  const heartbeatPruneTimer = setInterval(async () => {
    try {
      await runHeartbeatPruneTick(logger, fleetService);
    } catch (error) {
      logger.error({ err: error }, 'heartbeat_prune_failed');
    }
  }, 60_000);

  const retentionTimer = setInterval(async () => {
    try {
      await runGovernanceRetentionTick(logger, governanceService);
    } catch (error) {
      logger.error({ err: error }, 'governance_retention_monitor_failed');
    }
  }, config.GOVERNANCE_RETENTION_JOB_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(heartbeatTimer);
      clearInterval(workerHeartbeatTimer);
      clearInterval(timeoutTimer);
      clearInterval(dispatchTimer);
      clearInterval(heartbeatPruneTimer);
      clearInterval(retentionTimer);
    },
  };
}
