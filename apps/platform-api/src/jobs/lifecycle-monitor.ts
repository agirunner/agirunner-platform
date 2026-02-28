import type { FastifyBaseLogger } from 'fastify';

import { AgentService } from '../services/agent-service.js';
import { TaskService } from '../services/task-service.js';

export interface LifecycleMonitor {
  stop: () => void;
}

export function startLifecycleMonitor(
  logger: FastifyBaseLogger,
  agentService: AgentService,
  taskService: TaskService,
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
  }, 15_000);

  const timeoutTimer = setInterval(async () => {
    try {
      const affected = await taskService.failTimedOutTasks();
      if (affected > 0) {
        logger.info({ affected }, 'task_timeout_enforced');
      }
    } catch (error) {
      logger.error({ err: error }, 'task_timeout_monitor_failed');
    }
  }, 60_000);

  return {
    stop: () => {
      clearInterval(heartbeatTimer);
      clearInterval(timeoutTimer);
    },
  };
}
