import { describe, expect, it, vi } from 'vitest';

import { ConflictError } from '../../../src/errors/domain-errors.js';
import { WorkflowActivationService } from '../../../src/services/workflow-activation-service.js';

const identity = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin' as const,
  ownerType: 'tenant',
  ownerId: 'tenant-1',
  keyPrefix: 'admin-key',
};

describe('WorkflowActivationService', () => {
  it('returns the existing activation row when request_id conflicts', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('request_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-1',
              reason: 'work_item.created',
              event_type: 'work_item.created',
              payload: { work_item_id: 'wi-1' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const eventService = { emit: vi.fn() };
    const service = new WorkflowActivationService(pool as never, eventService as never);

    const result = await service.enqueue(identity, 'workflow-1', {
      request_id: 'req-1',
      reason: 'work_item.created',
      event_type: 'work_item.created',
      payload: { work_item_id: 'wi-1' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'activation-1',
        activation_id: 'activation-1',
        request_id: 'req-1',
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('treats activation payloads with reordered object keys as the same request replay', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-1',
              reason: 'work_item.created',
              event_type: 'work_item.created',
              payload: { stage_name: 'requirements', work_item_id: 'wi-1' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new WorkflowActivationService(pool as never, { emit: vi.fn() } as never);

    const result = await service.enqueue(identity, 'workflow-1', {
      request_id: 'req-1',
      reason: 'work_item.created',
      event_type: 'work_item.created',
      payload: { work_item_id: 'wi-1', stage_name: 'requirements' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'activation-1',
        request_id: 'req-1',
      }),
    );
  });

  it('rejects a request_id replay when the existing activation payload does not match', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM workflows')) {
          return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
        }
        if (sql.startsWith('INSERT INTO workflow_activations')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('request_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-1',
              reason: 'work_item.created',
              event_type: 'work_item.created',
              payload: { work_item_id: 'wi-existing' },
              state: 'queued',
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const service = new WorkflowActivationService(pool as never, { emit: vi.fn() } as never);

    await expect(
      service.enqueue(identity, 'workflow-1', {
        request_id: 'req-1',
        reason: 'work_item.created',
        event_type: 'work_item.created',
        payload: { work_item_id: 'wi-new' },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
