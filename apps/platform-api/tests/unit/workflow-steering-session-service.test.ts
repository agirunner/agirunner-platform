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

  it('creates steering sessions and appends workflow-scoped messages with linked interventions', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows') && sql.includes('SELECT id')) {
        return {
          rowCount: 1,
          rows: [{ id: 'workflow-1' }],
        };
      }
      if (sql.includes('INSERT INTO workflow_steering_sessions')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'session-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            title: 'Recovery session',
            status: 'active',
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: new Date('2026-03-27T10:00:00.000Z'),
            updated_at: new Date('2026-03-27T10:00:00.000Z'),
          }],
        };
      }
      if (sql.includes('FROM workflow_steering_sessions')) {
        return {
          rowCount: 1,
          rows: [{ id: 'session-1' }],
        };
      }
      if (sql.includes('INSERT INTO workflow_steering_messages')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'message-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            steering_session_id: 'session-1',
            role: params?.[4],
            content: params?.[5],
            structured_proposal: params?.[6] ?? {},
            intervention_id: params?.[7] ?? null,
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
            steering_session_id: 'session-1',
            role: 'operator',
            content: 'Focus on getting the verification path unblocked.',
            structured_proposal: { recommended_action: 'request_replan' },
            intervention_id: 'intervention-1',
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
    });
    const message = await service.appendMessage(IDENTITY as never, 'workflow-1', session.id, {
      role: 'operator',
      content: 'Focus on getting the verification path unblocked.',
      structuredProposal: { recommended_action: 'request_replan' },
      interventionId: 'intervention-1',
    });
    const messages = await service.listMessages('tenant-1', 'workflow-1', session.id);

    expect(session).toEqual(
      expect.objectContaining({
        id: 'session-1',
        title: 'Recovery session',
        workflow_id: 'workflow-1',
      }),
    );
    expect(message).toEqual(
      expect.objectContaining({
        id: 'message-1',
        role: 'operator',
        intervention_id: 'intervention-1',
      }),
    );
    expect(messages).toEqual([
      expect.objectContaining({
        id: 'message-1',
        role: 'operator',
        structured_proposal: { recommended_action: 'request_replan' },
      }),
    ]);
  });

  it('fallsBackToKeyPrefixWhenPersistingSystemOwnedSteeringSessionsAndMessages', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows') && sql.includes('SELECT id')) {
        return {
          rowCount: 1,
          rows: [{ id: 'workflow-1' }],
        };
      }
      if (sql.includes('INSERT INTO workflow_steering_sessions')) {
        expect(params?.[6]).toBe('admin-system');
        return {
          rowCount: 1,
          rows: [{
            id: 'session-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            title: null,
            status: 'active',
            created_by_type: 'system',
            created_by_id: 'admin-system',
            created_at: new Date('2026-03-27T10:00:00.000Z'),
            updated_at: new Date('2026-03-27T10:00:00.000Z'),
          }],
        };
      }
      if (sql.includes('FROM workflow_steering_sessions')) {
        return {
          rowCount: 1,
          rows: [{ id: 'session-1' }],
        };
      }
      if (sql.includes('INSERT INTO workflow_steering_messages')) {
        expect(params?.[9]).toBe('admin-system');
        return {
          rowCount: 1,
          rows: [{
            id: 'message-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            steering_session_id: 'session-1',
            role: 'operator',
            content: 'Continue with the attached packet.',
            structured_proposal: { recommended_action: 'continue' },
            intervention_id: null,
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
      role: 'operator',
      content: 'Continue with the attached packet.',
      structuredProposal: { recommended_action: 'continue' },
    });

    expect(session.created_by_type).toBe('system');
    expect(session.created_by_id).toBe('admin-system');
    expect(message.created_by_id).toBe('admin-system');
  });
});
