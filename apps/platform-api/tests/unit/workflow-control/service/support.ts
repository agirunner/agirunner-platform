import { vi } from 'vitest';

import { WorkflowControlService } from '../../../../src/services/workflow-control/workflow-control-service.js';

export const identity = {
  id: 'admin',
  tenantId: 'tenant-1',
  scope: 'admin' as const,
  ownerType: 'user',
  ownerId: null,
  keyPrefix: 'admin',
};

export function createPool(client: {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}) {
  return {
    connect: vi.fn(async () => client),
  };
}

export function createService(input: {
  pool: never;
  eventService?: { emit: ReturnType<typeof vi.fn> };
  stateService?: { recomputeWorkflowState: ReturnType<typeof vi.fn> };
  workflowControlDeps?: {
    resolveCancelSignalGracePeriodMs?: () => Promise<number>;
    workerConnectionHub?: { sendToWorker: ReturnType<typeof vi.fn> };
  };
}) {
  return new WorkflowControlService(
    input.pool,
    input.eventService as never,
    input.stateService as never,
    input.workflowControlDeps as never,
  );
}
