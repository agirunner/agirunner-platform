import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMessageRow,
  createPool,
  createSessionRow,
  createWorkflowSteeringSessionService,
  IDENTITY,
  SYSTEM_IDENTITY,
} from './support.js';

describe('WorkflowSteeringSessionService session messages', () => {
  let pool: ReturnType<typeof createPool>;
  let service: ReturnType<typeof createWorkflowSteeringSessionService>;

  beforeEach(() => {
    pool = createPool();
    service = createWorkflowSteeringSessionService(pool);
  });

  it('creates workflow-scoped sessions and appends durable request or response messages', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows') && sql.includes('SELECT id')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_work_items') && sql.includes('SELECT id')) {
        return { rowCount: 1, rows: [{ id: 'work-item-1' }] };
      }
      if (sql.includes('INSERT INTO workflow_steering_sessions')) {
        return {
          rowCount: 1,
          rows: [createSessionRow()],
        };
      }
      if (sql.includes('FROM workflow_steering_sessions') && sql.includes('AND id = $3')) {
        return {
          rowCount: 1,
          rows: [createSessionRow()],
        };
      }
      if (sql.includes('UPDATE workflow_steering_sessions')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('INSERT INTO workflow_steering_messages')) {
        return {
          rowCount: 1,
          rows: [createMessageRow(params)],
        };
      }
      if (sql.includes('FROM workflow_steering_messages')) {
        return {
          rowCount: 1,
          rows: [
            createMessageRow(undefined, {
              source_kind: 'operator',
              message_kind: 'operator_request',
            }),
          ],
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
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('INSERT INTO workflow_steering_sessions')) {
        expect(params?.[7]).toBe('admin-system');
        return {
          rowCount: 1,
          rows: [
            createSessionRow({
              work_item_id: null,
              title: null,
              created_by_type: 'system',
              created_by_id: 'admin-system',
            }),
          ],
        };
      }
      if (sql.includes('FROM workflow_steering_sessions') && sql.includes('AND id = $3')) {
        return {
          rowCount: 1,
          rows: [
            createSessionRow({
              work_item_id: null,
              title: null,
              created_by_type: 'system',
              created_by_id: 'admin-system',
            }),
          ],
        };
      }
      if (sql.includes('UPDATE workflow_steering_sessions')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('INSERT INTO workflow_steering_messages')) {
        expect(params?.[13]).toBe('admin-system');
        return {
          rowCount: 1,
          rows: [
            createMessageRow(params, {
              work_item_id: null,
              source_kind: 'platform',
              message_kind: 'steering_response',
              headline: 'Steering request recorded.',
              body: 'Continue with the attached packet.',
              linked_intervention_id: null,
              linked_input_packet_id: null,
              linked_operator_update_id: null,
              created_by_type: 'system',
              created_by_id: 'admin-system',
            }),
          ],
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
