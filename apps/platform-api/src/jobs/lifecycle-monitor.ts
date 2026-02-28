import type { FastifyBaseLogger } from 'fastify';

import type { AppEnv } from '../config/schema.js';
import { AgentService } from '../services/agent-service.js';
import { TaskService } from '../services/task-service.js';
import { WorkerService } from '../services/worker-service.js';

export interface LifecycleMonitor {
  stop: () => void;
}

export function startLifecycleMonitor(
  logger: FastifyBaseLogger,
  config: AppEnv,
  agentService: AgentService,
  taskService: TaskService,
  workerService: WorkerService,
): LifecycleMonitor {
  const heartbeatTimer = setInterval(async () => {
    try {
      const affected = await agentService.enforceHeartbeatTimeouts();
      if (affected > 0) {
        logger.info({ affected }, 'heartbeat_timeout_enforced');
      }
    } catch (error) {
      logger.error({ err: error }, 'heartbeat_monitor_failed');
    }
  }, config.LIFECYCLE_AGENT_HEARTBEAT_CHECK_INTERVAL_MS);

  const workerHeartbeatTimer = setInterval(async () => {
    try {
      const affected = await workerService.enforceHeartbeatTimeouts();
      if (affected > 0) {
        logger.info({ affected }, 'worker_heartbeat_timeout_enforced');
      }
    } catch (error) {
      logger.error({ err: error }, 'worker_heartbeat_monitor_failed');
    }
  }, config.LIFECYCLE_WORKER_HEARTBEAT_CHECK_INTERVAL_MS);

  const timeoutTimer = setInterval(async () => {
    try {
      const affected = await taskService.failTimedOutTasks();
      if (affected > 0) {
        logger.info({ affected }, 'task_timeout_enforced');
      }
    } catch (error) {
      logger.error({ err: error }, 'task_timeout_monitor_failed');
    }
  }, config.LIFECYCLE_TASK_TIMEOUT_CHECK_INTERVAL_MS);

  const dispatchTimer = setInterval(async () => {
    try {
      await workerService.releaseExpiredDispatches();
      await workerService.dispatchReadyTasks();
    } catch (error) {
      logger.error({ err: error }, 'worker_dispatch_monitor_failed');
    }
  }, config.LIFECYCLE_DISPATCH_LOOP_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(heartbeatTimer);
      clearInterval(workerHeartbeatTimer);
      clearInterval(timeoutTimer);
      clearInterval(dispatchTimer);
    },
  };
}
