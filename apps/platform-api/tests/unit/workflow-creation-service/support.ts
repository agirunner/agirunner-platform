import { vi } from 'vitest';

import { WorkflowCreationService } from '../../../src/services/workflow-creation-service.js';

export const IDENTITY = {
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'tenant',
  ownerId: 'tenant-1',
  keyPrefix: 'admin-key',
  id: 'key-1',
} as const;

export function createPlaybookDefinition(
  overrides: Record<string, unknown> = {},
  stageName = 'implementation',
) {
  return {
    lifecycle: 'planned',
    board: { columns: [{ id: 'planned', label: 'Planned' }] },
    stages: [{ name: stageName, goal: 'Build it' }],
    roles: ['developer'],
    ...overrides,
  };
}

export function createPlaybookRow(definition: Record<string, unknown>) {
  return {
    id: 'playbook-1',
    version: 1,
    definition,
  };
}

export function createClient() {
  return {
    query: vi.fn(),
    release: vi.fn(),
  };
}

export function createWorkflowCreationService(
  client: ReturnType<typeof createClient>,
  overrides: Partial<ConstructorParameters<typeof WorkflowCreationService>[0]> = {},
) {
  return new WorkflowCreationService({
    pool: { connect: vi.fn(async () => client) } as never,
    eventService: { emit: vi.fn(async () => undefined) } as never,
    stateService: {} as never,
    activationService: { enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-1' })) } as never,
    activationDispatchService: { dispatchActivation: vi.fn(async () => null) } as never,
    stageService: { createStages: vi.fn(async () => []) } as never,
    inputPacketService: { createWorkflowInputPacket: vi.fn(async () => ({ id: 'packet-launch-1' })) } as never,
    ...overrides,
  });
}

export function isTransactionControl(sql: string) {
  return sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK';
}
