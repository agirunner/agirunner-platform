import { describe, expect, it, vi } from 'vitest';

import {
  createClient,
  createPlaybookDefinition,
  createPlaybookRow,
  createWorkflowCreationService,
  IDENTITY,
  isTransactionControl,
} from './support.js';

describe('WorkflowCreationService launch input packet', () => {
  it('materializes a launch input packet with request and operator provenance when a workflow is created', async () => {
    const createWorkflowInputPacket = vi.fn(async () => ({ id: 'packet-launch-1' }));
    const client = createClient();
    client.query.mockImplementation(async (sql: string) => {
      if (isTransactionControl(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT * FROM playbooks')) {
        return { rowCount: 1, rows: [createPlaybookRow(createPlaybookDefinition())] };
      }
      if (sql.includes('INSERT INTO workflows')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            playbook_id: 'playbook-1',
            lifecycle: 'planned',
            current_stage: 'implementation',
          }],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = createWorkflowCreationService(client, {
      inputPacketService: { createWorkflowInputPacket } as never,
    });

    await service.createWorkflow(IDENTITY as never, {
      playbook_id: 'playbook-1',
      name: 'Workflow One',
      request_id: 'request-1',
      operator_note: 'Prioritize the verification branch first.',
      initial_input_packet: {
        summary: 'Launch packet summary',
        structured_inputs: { ticket: 'INC-42' },
      },
    } as never);

    expect(createWorkflowInputPacket).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: 'request-1',
        packetKind: 'launch',
        createdByKind: 'operator',
        summary: 'Launch packet summary',
        structuredInputs: { ticket: 'INC-42' },
        metadata: expect.objectContaining({
          operator_note: 'Prioritize the verification branch first.',
        }),
      }),
      expect.anything(),
    );
  });
});
