import { vi } from 'vitest';

import { WorkflowCancellationService } from '../../../../src/services/workflow-control/workflow-cancellation-service.js';

export const identity = {
  id: 'admin',
  tenantId: 'tenant-1',
  scope: 'admin' as const,
  ownerType: 'user',
  ownerId: null,
  keyPrefix: 'admin',
};

export function makeCancellationService(overrides?: {
  client?: ReturnType<typeof makeTransactionClient>;
  getWorkflow?: ReturnType<typeof vi.fn>;
  eventService?: { emit: ReturnType<typeof vi.fn> };
  stateService?: { recomputeWorkflowState: ReturnType<typeof vi.fn> };
  workerConnectionHub?: { sendToWorker: ReturnType<typeof vi.fn> };
}) {
  const client = overrides?.client ?? makeTransactionClient(vi.fn());
  return new WorkflowCancellationService({
    pool: { connect: vi.fn(async () => client) } as never,
    eventService: overrides?.eventService ?? { emit: vi.fn(async () => undefined) },
    stateService: overrides?.stateService ?? { recomputeWorkflowState: vi.fn(async () => 'cancelled') },
    resolveCancelSignalGracePeriodMs: async () => 60_000,
    workerConnectionHub: overrides?.workerConnectionHub as never,
    getWorkflow: overrides?.getWorkflow ?? vi.fn(async () => ({ id: 'workflow-1', state: 'cancelled' })),
  });
}

export function makeTransactionClient(query: ReturnType<typeof vi.fn>) {
  return {
    query,
    release: vi.fn(),
  };
}
