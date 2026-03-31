import { beforeEach, describe, expect, it } from 'vitest';

import {
  createInterventionService,
  createMessageRow,
  createPool,
  createSessionRow,
  createWorkflowSteeringSessionService,
  IDENTITY,
} from './support.js';

describe('WorkflowSteeringSessionService steering requests', () => {
  let pool: ReturnType<typeof createPool>;
  let interventionService: ReturnType<typeof createInterventionService>;
  let service: ReturnType<typeof createWorkflowSteeringSessionService>;

  beforeEach(() => {
    pool = createPool();
    interventionService = createInterventionService();
    service = createWorkflowSteeringSessionService(pool, interventionService);
  });

  it('records structured steering interventions when steering requests are submitted', async () => {
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
          rows: [
            createSessionRow({
              title: 'Focus on the verification path first.',
            }),
          ],
        };
      }
      if (sql.includes('FROM workflow_steering_sessions') && sql.includes('AND id = $3')) {
        return {
          rowCount: 1,
          rows: [
            createSessionRow({
              title: 'Focus on the verification path first.',
            }),
          ],
        };
      }
      if (sql.includes('INSERT INTO workflow_steering_messages')) {
        return {
          rowCount: 1,
          rows: [createMessageRow(params)],
        };
      }
      if (sql.includes('UPDATE workflow_steering_sessions')) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    interventionService.recordIntervention.mockResolvedValue({ id: 'intervention-1' });

    const result = await service.recordSteeringRequest(IDENTITY as never, 'workflow-1', {
      requestId: 'request-1',
      request: 'Focus on the verification path first.',
      workItemId: 'work-item-1',
      linkedInputPacketIds: ['packet-1'],
      baseSnapshotVersion: 'snapshot-7',
    });

    expect(interventionService.recordIntervention).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: 'request-1',
        kind: 'steering_request',
        outcome: 'applied',
        resultKind: 'steering_request_recorded',
        snapshotVersion: 'snapshot-7',
        workItemId: 'work-item-1',
        structuredAction: expect.objectContaining({
          kind: 'steer_work_item',
          request: 'Focus on the verification path first.',
          linked_input_packet_ids: ['packet-1'],
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        intervention_id: 'intervention-1',
        snapshot_version: 'snapshot-7',
        linked_intervention_ids: ['intervention-1'],
        linked_input_packet_ids: ['packet-1'],
        request_message_id: 'message-1',
        response_message_id: null,
      }),
    );
  });

  it('records task-scoped steering with the task id in the linked intervention payload', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows') && sql.includes('SELECT id')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM tasks') && sql.includes('SELECT work_item_id')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'task-1']);
        return { rowCount: 1, rows: [{ work_item_id: 'work-item-1' }] };
      }
      if (sql.includes('FROM workflow_work_items') && sql.includes('SELECT id')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
        return { rowCount: 1, rows: [{ id: 'work-item-1' }] };
      }
      if (sql.includes('INSERT INTO workflow_steering_sessions')) {
        return {
          rowCount: 1,
          rows: [
            createSessionRow({
              title: 'Keep the task limited to the current rollback-safe scope.',
            }),
          ],
        };
      }
      if (sql.includes('FROM workflow_steering_sessions') && sql.includes('AND id = $3')) {
        return {
          rowCount: 1,
          rows: [
            createSessionRow({
              title: 'Keep the task limited to the current rollback-safe scope.',
            }),
          ],
        };
      }
      if (sql.includes('INSERT INTO workflow_steering_messages')) {
        return {
          rowCount: 1,
          rows: [createMessageRow(params)],
        };
      }
      if (sql.includes('UPDATE workflow_steering_sessions')) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    interventionService.recordIntervention.mockResolvedValue({ id: 'intervention-task-1' });

    const result = await service.recordSteeringRequest(IDENTITY as never, 'workflow-1', {
      requestId: 'request-task-1',
      request: 'Keep the task limited to the current rollback-safe scope.',
      taskId: 'task-1',
      linkedInputPacketIds: ['packet-task-1'],
    });

    expect(interventionService.recordIntervention).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: 'request-task-1',
        workItemId: 'work-item-1',
        taskId: 'task-1',
        structuredAction: expect.objectContaining({
          kind: 'steer_task',
          task_id: 'task-1',
          work_item_id: 'work-item-1',
          linked_input_packet_ids: ['packet-task-1'],
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        resulting_work_item_id: 'work-item-1',
        linked_intervention_ids: ['intervention-task-1'],
        linked_input_packet_ids: ['packet-task-1'],
        request_message_id: 'message-1',
        response_message_id: null,
      }),
    );
  });
});
