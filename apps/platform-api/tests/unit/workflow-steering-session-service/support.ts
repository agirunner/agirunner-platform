import { vi } from 'vitest';

import { WorkflowSteeringSessionService } from '../../../src/services/workflow-steering-session-service/workflow-steering-session-service.js';

export const IDENTITY = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'user',
  ownerId: 'user-1',
  keyPrefix: 'admin',
} as const;

export const SYSTEM_IDENTITY = {
  id: 'key-system-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'system',
  ownerId: null,
  keyPrefix: 'admin-system',
} as const;

export function createPool() {
  return {
    query: vi.fn(),
  };
}

export function createInterventionService() {
  return {
    recordIntervention: vi.fn(),
  };
}

export function createWorkflowSteeringSessionService(
  pool: ReturnType<typeof createPool>,
  interventionService = createInterventionService(),
) {
  return new WorkflowSteeringSessionService(pool as never, interventionService as never);
}

export function createSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    tenant_id: 'tenant-1',
    workflow_id: 'workflow-1',
    work_item_id: 'work-item-1',
    title: 'Recovery session',
    status: 'open',
    created_by_type: 'user',
    created_by_id: 'user-1',
    created_at: new Date('2026-03-27T10:00:00.000Z'),
    updated_at: new Date('2026-03-27T10:00:00.000Z'),
    last_message_at: null,
    ...overrides,
  };
}

export function createMessageRow(
  params?: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'message-1',
    tenant_id: 'tenant-1',
    workflow_id: 'workflow-1',
    work_item_id: 'work-item-1',
    steering_session_id: 'session-1',
    source_kind: params?.[5] ?? 'operator',
    message_kind: params?.[6] ?? 'operator_request',
    headline: params?.[7] ?? 'Focus on getting the verification path unblocked.',
    body: params?.[8] ?? 'Prefer the rollback-safe path.',
    linked_intervention_id: params?.[9] ?? 'intervention-1',
    linked_input_packet_id: params?.[10] ?? 'packet-1',
    linked_operator_update_id: params?.[11] ?? 'update-1',
    created_by_type: 'user',
    created_by_id: params?.[13] ?? 'user-1',
    created_at: new Date('2026-03-27T10:05:00.000Z'),
    ...overrides,
  };
}
