import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkflowAddWorkService } from '../../../src/services/workflow-add-work-service.js';

const IDENTITY = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'user',
  ownerId: 'user-1',
  keyPrefix: 'admin',
} as const;

function createClient() {
  return {
    query: vi.fn(),
    release: vi.fn(),
  };
}

describe('WorkflowAddWorkService', () => {
  let client: ReturnType<typeof createClient>;
  let pool: { connect: ReturnType<typeof vi.fn> };
  let workItemService: { createWorkItem: ReturnType<typeof vi.fn> };
  let activationService: { enqueueForWorkflow: ReturnType<typeof vi.fn> };
  let activationDispatchService: { dispatchActivation: ReturnType<typeof vi.fn> };
  let inputPacketService: { createWorkflowInputPacket: ReturnType<typeof vi.fn> };
  let service: WorkflowAddWorkService;

  beforeEach(() => {
    client = createClient();
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT lifecycle') && sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ lifecycle: 'ongoing' }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    pool = {
      connect: vi.fn(async () => client),
    };
    workItemService = {
      createWorkItem: vi.fn(async () => ({
        id: 'work-item-1',
        workflow_id: 'workflow-1',
        stage_name: 'intake-triage',
        title: 'Tell me a joke',
      })),
    };
    activationService = {
      enqueueForWorkflow: vi.fn(async () => ({ id: 'activation-1' })),
    };
    activationDispatchService = {
      dispatchActivation: vi.fn(async () => undefined),
    };
    inputPacketService = {
      createWorkflowInputPacket: vi.fn(async () => ({ id: 'packet-1' })),
    };
    service = new WorkflowAddWorkService({
      pool: pool as never,
      workItemService: workItemService as never,
      activationService: activationService as never,
      activationDispatchService: activationDispatchService as never,
      inputPacketService: inputPacketService as never,
    });
  });

  it('creates the work item and its initial input packet before dispatching activation', async () => {
    const result = await service.createWorkItem(IDENTITY as never, 'workflow-1', {
      request_id: 'request-1',
      title: 'Tell me a joke',
      initial_input_packet: {
        summary: 'Operator prompt',
        structured_inputs: { prompt: 'Tell me a joke' },
      },
    });

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(workItemService.createWorkItem).toHaveBeenCalledWith(
      IDENTITY,
      'workflow-1',
      expect.objectContaining({
        request_id: 'request-1',
        title: 'Tell me a joke',
      }),
      client,
      { dispatchActivation: false },
    );
    expect(inputPacketService.createWorkflowInputPacket).toHaveBeenCalledWith(
      IDENTITY,
      'workflow-1',
      expect.objectContaining({
        requestId: 'request-1',
        packetKind: 'intake',
        workItemId: 'work-item-1',
        summary: 'Operator prompt',
        structuredInputs: { prompt: 'Tell me a joke' },
      }),
      client,
    );
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        requestId: 'work-item:request-1',
        payload: {
          work_item_id: 'work-item-1',
          stage_name: 'intake-triage',
        },
      }),
      client,
    );
    expect(activationDispatchService.dispatchActivation).toHaveBeenCalledWith(
      'tenant-1',
      'activation-1',
      client,
    );
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(result).toEqual(
      expect.objectContaining({
        id: 'work-item-1',
        title: 'Tell me a joke',
      }),
    );
  });

  it('delegates to the existing work-item path when there is no initial packet content', async () => {
    const result = await service.createWorkItem(IDENTITY as never, 'workflow-1', {
      request_id: 'request-1',
      title: 'Tell me a joke',
      initial_input_packet: {
        structured_inputs: {},
        files: [],
      },
    });

    expect(pool.connect).not.toHaveBeenCalled();
    expect(workItemService.createWorkItem).toHaveBeenCalledWith(
      IDENTITY,
      'workflow-1',
      expect.objectContaining({
        request_id: 'request-1',
        title: 'Tell me a joke',
      }),
      undefined,
    );
    expect(inputPacketService.createWorkflowInputPacket).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 'work-item-1',
      }),
    );
  });
});
