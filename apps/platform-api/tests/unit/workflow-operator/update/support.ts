import { vi } from 'vitest';

import { WorkflowOperatorUpdateService } from '../../../../src/services/workflow-operator/workflow-operator-update-service.js';

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

export function createService(pool: ReturnType<typeof createPool>) {
  return new WorkflowOperatorUpdateService(pool as never);
}
