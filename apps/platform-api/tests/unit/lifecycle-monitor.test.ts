import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  runWorkflowActivationDispatchTick,
  startLifecycleMonitor,
} from '../../src/jobs/lifecycle-monitor.js';

describe('startLifecycleMonitor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs activation recovery and logs when stale activations were recovered', async () => {
    vi.useFakeTimers();

    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const agentService = {
      enforceHeartbeatTimeouts: vi.fn(async () => 0),
    };
    const taskService = {
      failTimedOutTasks: vi.fn(async () => 0),
      finalizeGracefulWorkflowCancellations: vi.fn(async () => 0),
    };
    const workerService = {
      enforceHeartbeatTimeouts: vi.fn(async () => 0),
      releaseExpiredDispatches: vi.fn(async () => undefined),
      dispatchReadyTasks: vi.fn(async () => undefined),
    };
    const workflowActivationDispatchService = {
      recoverStaleActivations: vi.fn(async () => ({
        requeued: 1,
        redispatched: 1,
        reported: 1,
        details: [
          {
            activation_id: 'activation-1',
            workflow_id: 'workflow-1',
            status: 'redispatched',
            reason: 'missing_orchestrator_task',
            stale_started_at: '2026-03-11T00:00:00.000Z',
            detected_at: '2026-03-11T00:05:00.000Z',
            redispatched_task_id: 'task-9',
          },
        ],
      })),
      enqueueHeartbeatActivations: vi.fn(async () => 2),
      dispatchQueuedActivations: vi.fn(async () => 0),
    };
    const scheduledWorkItemTriggerService = {
      fireDueTriggers: vi.fn(async () => ({
        claimed: 1,
        fired: 1,
        duplicates: 0,
        failed: 0,
      })),
    };

    const monitor = startLifecycleMonitor(
      logger as never,
      {
        LIFECYCLE_AGENT_HEARTBEAT_CHECK_INTERVAL_MS: 60_000,
        LIFECYCLE_WORKER_HEARTBEAT_CHECK_INTERVAL_MS: 60_000,
        LIFECYCLE_TASK_TIMEOUT_CHECK_INTERVAL_MS: 60_000,
        LIFECYCLE_DISPATCH_LOOP_INTERVAL_MS: 1_000,
        GOVERNANCE_RETENTION_JOB_INTERVAL_MS: 60_000,
      } as never,
      agentService as never,
      taskService as never,
      workerService as never,
      workflowActivationDispatchService as never,
      scheduledWorkItemTriggerService as never,
    );

    await vi.advanceTimersByTimeAsync(1_000);

    expect(scheduledWorkItemTriggerService.fireDueTriggers).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { claimed: 1, fired: 1, duplicates: 0, failed: 0 },
      'scheduled_work_item_triggers_processed',
    );
    expect(workflowActivationDispatchService.recoverStaleActivations).toHaveBeenCalledTimes(1);
    expect(workflowActivationDispatchService.dispatchQueuedActivations).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      {
        requeued: 1,
        redispatched: 1,
        reported: 1,
        details: [
          {
            activation_id: 'activation-1',
            workflow_id: 'workflow-1',
            status: 'redispatched',
            reason: 'missing_orchestrator_task',
            stale_started_at: '2026-03-11T00:00:00.000Z',
            detected_at: '2026-03-11T00:05:00.000Z',
            redispatched_task_id: 'task-9',
          },
        ],
      },
      'workflow_activation_recovery_enforced',
    );
    expect(workflowActivationDispatchService.enqueueHeartbeatActivations).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { enqueued: 2 },
      'workflow_activation_heartbeats_enqueued',
    );
    expect(workflowActivationDispatchService.dispatchQueuedActivations).toHaveBeenCalledTimes(1);

    monitor.stop();
  });

  it('supports a single-shot workflow activation dispatch tick without timers', async () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const workflowActivationDispatchService = {
      recoverStaleActivations: vi.fn(async () => ({
        requeued: 0,
        redispatched: 0,
        reported: 0,
        details: [],
      })),
      enqueueHeartbeatActivations: vi.fn(async () => 1),
      dispatchQueuedActivations: vi.fn(async () => 1),
    };
    const scheduledWorkItemTriggerService = {
      fireDueTriggers: vi.fn(async () => ({
        claimed: 0,
        fired: 2,
        duplicates: 0,
        failed: 0,
      })),
    };

    await runWorkflowActivationDispatchTick(
      logger as never,
      workflowActivationDispatchService as never,
      scheduledWorkItemTriggerService as never,
    );

    expect(scheduledWorkItemTriggerService.fireDueTriggers).toHaveBeenCalledTimes(1);
    expect(workflowActivationDispatchService.recoverStaleActivations).toHaveBeenCalledTimes(1);
    expect(workflowActivationDispatchService.enqueueHeartbeatActivations).toHaveBeenCalledTimes(1);
    expect(workflowActivationDispatchService.dispatchQueuedActivations).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { claimed: 0, fired: 2, duplicates: 0, failed: 0 },
      'scheduled_work_item_triggers_processed',
    );
    expect(logger.info).toHaveBeenCalledWith(
      { enqueued: 1 },
      'workflow_activation_heartbeats_enqueued',
    );
  });
});
