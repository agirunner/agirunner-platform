import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  acknowledgeTaskAssignmentMock,
  claimTaskForWorkerMock,
  findDispatchCandidateWorkersMock,
  findReadyTasksMock,
  markWorkerBusyMock,
  resetExpiredDispatchMock,
  resetTaskClaimMock,
} = vi.hoisted(() => ({
  acknowledgeTaskAssignmentMock: vi.fn(),
  claimTaskForWorkerMock: vi.fn(),
  findDispatchCandidateWorkersMock: vi.fn(),
  findReadyTasksMock: vi.fn(),
  markWorkerBusyMock: vi.fn(),
  resetExpiredDispatchMock: vi.fn(),
  resetTaskClaimMock: vi.fn(),
}));

vi.mock('../../../src/services/worker-dispatch-repository.js', () => ({
  acknowledgeTaskAssignment: acknowledgeTaskAssignmentMock,
  claimTaskForWorker: claimTaskForWorkerMock,
  findDispatchCandidateWorkers: findDispatchCandidateWorkersMock,
  findReadyTasks: findReadyTasksMock,
  markWorkerBusy: markWorkerBusyMock,
  resetExpiredDispatch: resetExpiredDispatchMock,
  resetTaskClaim: resetTaskClaimMock,
}));

import { WorkerConnectionHub } from '../../../src/services/worker-connection-hub.js';
import { dispatchReadyTasks } from '../../../src/services/worker-dispatch-service.js';

describe('dispatchReadyTasks role-first routing', () => {
  beforeEach(() => {
    acknowledgeTaskAssignmentMock.mockReset();
    claimTaskForWorkerMock.mockReset();
    findDispatchCandidateWorkersMock.mockReset();
    findReadyTasksMock.mockReset();
    markWorkerBusyMock.mockReset();
    resetExpiredDispatchMock.mockReset();
    resetTaskClaimMock.mockReset();
  });

  it('passes the internal role tag for workflow specialist tasks', async () => {
    findReadyTasksMock.mockResolvedValue([
      {
        id: 'task-1',
        tenant_id: 'tenant-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        is_orchestrator_task: false,
        role: 'developer',
      },
    ]);
    findDispatchCandidateWorkersMock.mockResolvedValue([]);

    const connectionHub = new WorkerConnectionHub();
    connectionHub.registerWorker('worker-1', 'tenant-1', {
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1,
      OPEN: 1,
    } as never);

    const context = {
      pool: {} as never,
      eventService: { emit: vi.fn().mockResolvedValue(undefined) },
      connectionHub,
      config: {
        WORKER_DISPATCH_BATCH_LIMIT: 25,
        WORKER_DISPATCH_ACK_TIMEOUT_MS: 5_000,
        WORKER_RECONNECT_MIN_MS: 250,
        WORKER_RECONNECT_MAX_MS: 5_000,
      },
    };

    await dispatchReadyTasks(context as never);

    expect(findDispatchCandidateWorkersMock).toHaveBeenCalledWith(
      context.pool,
      'tenant-1',
      ['worker-1'],
      'role:developer',
    );
  });
});
