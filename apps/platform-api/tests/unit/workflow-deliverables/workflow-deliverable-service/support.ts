import { vi } from 'vitest';

import { WorkflowDeliverableService } from '../../../../src/services/workflow-deliverables/workflow-deliverable-service.js';

export const IDENTITY = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'user',
  ownerId: 'user-1',
  keyPrefix: 'admin',
} as const;

export function createPool() {
  return {
    query: vi.fn(),
  };
}

export function createService() {
  const pool = createPool();
  const service = new WorkflowDeliverableService(pool as never);
  return { pool, service };
}
