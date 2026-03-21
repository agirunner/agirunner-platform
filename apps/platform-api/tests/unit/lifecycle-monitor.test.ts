import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/platform-timing-defaults.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/platform-timing-defaults.js')>(
    '../../src/services/platform-timing-defaults.js',
  );
  return {
    ...actual,
    readLifecycleMonitorTimingDefaults: vi.fn(async () => ({
      agentHeartbeatIntervalMs: 60_000,
      workerHeartbeatIntervalMs: 60_000,
      taskTimeoutIntervalMs: 60_000,
      dispatchLoopIntervalMs: 1_000,
      heartbeatPruneIntervalMs: 60_000,
      governanceRetentionIntervalMs: 60_000,
    })),
  };
});

import {
  runHeartbeatPruneTick,
  runWorkflowActivationDispatchTick,
  startLifecycleMonitor,
} from '../../src/jobs/lifecycle-monitor.js';
import { readLifecycleMonitorTimingDefaults } from '../../src/services/platform-timing-defaults.js';

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
    const monitor = startLifecycleMonitor(
      logger as never,
      { query: vi.fn() } as never,
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
    );

    await vi.advanceTimersByTimeAsync(1_000);

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

  it('re-reads dispatch loop timing between cycles', async () => {
    vi.useFakeTimers();
    const readTimingDefaults = vi.mocked(readLifecycleMonitorTimingDefaults);
    let dispatchLoopIntervalMs = 1_000;
    readTimingDefaults.mockImplementation(async () => ({
      agentHeartbeatIntervalMs: 60_000,
      workerHeartbeatIntervalMs: 60_000,
      taskTimeoutIntervalMs: 60_000,
      dispatchLoopIntervalMs,
      heartbeatPruneIntervalMs: 60_000,
      governanceRetentionIntervalMs: 60_000,
    }));

    const workerService = {
      enforceHeartbeatTimeouts: vi.fn(async () => 0),
      releaseExpiredDispatches: vi.fn(async () => undefined),
      dispatchReadyTasks: vi.fn(async () => undefined),
    };
    const workflowActivationDispatchService = {
      recoverStaleActivations: vi.fn(async () => ({
        requeued: 0,
        redispatched: 0,
        reported: 0,
        details: [],
      })),
      enqueueHeartbeatActivations: vi.fn(async () => 0),
      dispatchQueuedActivations: vi.fn(async () => 0),
    };

    const monitor = startLifecycleMonitor(
      { info: vi.fn(), error: vi.fn() } as never,
      { query: vi.fn() } as never,
      {
        LIFECYCLE_AGENT_HEARTBEAT_CHECK_INTERVAL_MS: 60_000,
        LIFECYCLE_WORKER_HEARTBEAT_CHECK_INTERVAL_MS: 60_000,
        LIFECYCLE_TASK_TIMEOUT_CHECK_INTERVAL_MS: 60_000,
        LIFECYCLE_DISPATCH_LOOP_INTERVAL_MS: 1_000,
        GOVERNANCE_RETENTION_JOB_INTERVAL_MS: 60_000,
      } as never,
      { enforceHeartbeatTimeouts: vi.fn(async () => 0) } as never,
      {
        failTimedOutTasks: vi.fn(async () => 0),
        finalizeGracefulWorkflowCancellations: vi.fn(async () => 0),
      } as never,
      workerService as never,
      workflowActivationDispatchService as never,
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(workflowActivationDispatchService.dispatchQueuedActivations).toHaveBeenCalledTimes(1);

    dispatchLoopIntervalMs = 5_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(workflowActivationDispatchService.dispatchQueuedActivations).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(workflowActivationDispatchService.dispatchQueuedActivations).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(workflowActivationDispatchService.dispatchQueuedActivations).toHaveBeenCalledTimes(3);

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
    await runWorkflowActivationDispatchTick(logger as never, workflowActivationDispatchService as never);
    expect(workflowActivationDispatchService.recoverStaleActivations).toHaveBeenCalledTimes(1);
    expect(workflowActivationDispatchService.enqueueHeartbeatActivations).toHaveBeenCalledTimes(1);
    expect(workflowActivationDispatchService.dispatchQueuedActivations).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { enqueued: 1 },
      'workflow_activation_heartbeats_enqueued',
    );
  });

  it('prunes stale heartbeats using fleet-configured thresholds', async () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const fleetService = {
      pruneStaleHeartbeats: vi.fn(async () => 2),
    };

    const result = await runHeartbeatPruneTick(logger as never, fleetService as never);

    expect(result).toBe(2);
    expect(fleetService.pruneStaleHeartbeats).toHaveBeenCalledTimes(1);
    expect(fleetService.pruneStaleHeartbeats).toHaveBeenCalledWith();
    expect(logger.info).toHaveBeenCalledWith({ pruned: 2 }, 'stale_heartbeats_pruned');
  });
});
