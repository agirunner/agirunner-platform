import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkflowSteeringSessionService } from '../../src/services/workflow-steering-session-service.js';

const IDENTITY = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'user',
  ownerId: 'user-1',
  keyPrefix: 'admin',
} as const;

const SYSTEM_IDENTITY = {
  id: 'key-system-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'system',
  ownerId: null,
  keyPrefix: 'admin-system',
} as const;

function createPool() {
  return {
    query: vi.fn(),
  };
}

describe('WorkflowSteeringSessionService', () => {
  let pool: ReturnType<typeof createPool>;
  let service: WorkflowSteeringSessionService;

  beforeEach(() => {
    pool = createPool();
    service = new WorkflowSteeringSessionService(pool as never);
  });

  it('creates workflow-scoped sessions and appends durable request or response messages', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows') && sql.includes('SELECT id')) {
        return {
          rowCount: 1,
          rows: [{ id: 'workflow-1' }],
        };
      }
      if (sql.includes('FROM workflow_work_items') && sql.includes('SELECT id')) {
        return {
          rowCount: 1,
          rows: [{ id: 'work-item-1' }],
        };
      }
      if (sql.includes('INSERT INTO workflow_steering_sessions')) {
        return {
          rowCount: 1,
          rows: [{
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
          }],
        };
      }
      if (sql.includes('FROM workflow_steering_sessions') && sql.includes('AND id = $3')) {
        return {
          rowCount: 1,
          rows: [{
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
          }],
        };
      }
      if (sql.includes('UPDATE workflow_steering_sessions')) {
        return {
          rowCount: 1,
          rows: [],
        };
      }
      if (sql.includes('INSERT INTO workflow_steering_messages')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'message-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            steering_session_id: 'session-1',
            source_kind: params?.[5],
            message_kind: params?.[6],
            headline: params?.[7],
            body: params?.[8] ?? null,
            linked_intervention_id: params?.[9] ?? null,
            linked_input_packet_id: params?.[10] ?? null,
            linked_operator_update_id: params?.[11] ?? null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-27T10:05:00.000Z'),
          }],
        };
      }
      if (sql.includes('FROM workflow_steering_messages')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'message-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            steering_session_id: 'session-1',
            source_kind: 'operator',
            message_kind: 'operator_request',
            headline: 'Focus on getting the verification path unblocked.',
            body: 'Prefer the rollback-safe path.',
            linked_intervention_id: 'intervention-1',
            linked_input_packet_id: 'packet-1',
            linked_operator_update_id: 'update-1',
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-27T10:05:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const session = await service.createSession(IDENTITY as never, 'workflow-1', {
      title: 'Recovery session',
      workItemId: 'work-item-1',
    });
    const message = await service.appendMessage(IDENTITY as never, 'workflow-1', session.id, {
      workItemId: 'work-item-1',
      sourceKind: 'operator',
      messageKind: 'operator_request',
      headline: 'Focus on getting the verification path unblocked.',
      body: 'Prefer the rollback-safe path.',
      linkedInterventionId: 'intervention-1',
      linkedInputPacketId: 'packet-1',
      linkedOperatorUpdateId: 'update-1',
    });
    const messages = await service.listMessages('tenant-1', 'workflow-1', session.id);

    expect(session).toEqual(
      expect.objectContaining({
        id: 'session-1',
        title: 'Recovery session',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        status: 'open',
      }),
    );
    expect(message).toEqual(
      expect.objectContaining({
        id: 'message-1',
        source_kind: 'operator',
        message_kind: 'operator_request',
        linked_intervention_id: 'intervention-1',
        linked_input_packet_id: 'packet-1',
        linked_operator_update_id: 'update-1',
      }),
    );
    expect(messages).toEqual([
      expect.objectContaining({
        id: 'message-1',
        source_kind: 'operator',
        message_kind: 'operator_request',
        body: 'Prefer the rollback-safe path.',
      }),
    ]);
  });

  it('falls back to key prefix when persisting system-owned steering sessions and messages', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows') && sql.includes('SELECT id')) {
        return {
          rowCount: 1,
          rows: [{ id: 'workflow-1' }],
        };
      }
      if (sql.includes('INSERT INTO workflow_steering_sessions')) {
        expect(params?.[7]).toBe('admin-system');
        return {
          rowCount: 1,
          rows: [{
            id: 'session-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            title: null,
            status: 'open',
            created_by_type: 'system',
            created_by_id: 'admin-system',
            created_at: new Date('2026-03-27T10:00:00.000Z'),
            updated_at: new Date('2026-03-27T10:00:00.000Z'),
            last_message_at: null,
          }],
        };
      }
      if (sql.includes('FROM workflow_steering_sessions') && sql.includes('AND id = $3')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'session-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            title: null,
            status: 'open',
            created_by_type: 'system',
            created_by_id: 'admin-system',
            created_at: new Date('2026-03-27T10:00:00.000Z'),
            updated_at: new Date('2026-03-27T10:00:00.000Z'),
            last_message_at: null,
          }],
        };
      }
      if (sql.includes('UPDATE workflow_steering_sessions')) {
        return {
          rowCount: 1,
          rows: [],
        };
      }
      if (sql.includes('INSERT INTO workflow_steering_messages')) {
        expect(params?.[13]).toBe('admin-system');
        return {
          rowCount: 1,
          rows: [{
            id: 'message-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            steering_session_id: 'session-1',
            source_kind: 'platform',
            message_kind: 'steering_response',
            headline: 'Steering request recorded.',
            body: 'Continue with the attached packet.',
            linked_intervention_id: null,
            linked_input_packet_id: null,
            linked_operator_update_id: null,
            created_by_type: 'system',
            created_by_id: 'admin-system',
            created_at: new Date('2026-03-27T10:05:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const session = await service.createSession(SYSTEM_IDENTITY as never, 'workflow-1');
    const message = await service.appendMessage(SYSTEM_IDENTITY as never, 'workflow-1', session.id, {
      sourceKind: 'platform',
      messageKind: 'steering_response',
      headline: 'Steering request recorded.',
      body: 'Continue with the attached packet.',
    });

    expect(session.created_by_type).toBe('system');
    expect(session.created_by_id).toBe('admin-system');
    expect(message.created_by_id).toBe('admin-system');
  });
});
