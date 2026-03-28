import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotFoundError, ValidationError } from '../../src/errors/domain-errors.js';
import { WorkflowRedriveService } from '../../src/services/workflow-redrive-service.js';

const IDENTITY = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'user',
  ownerId: 'user-1',
  keyPrefix: 'admin',
} as const;

function createPool() {
  return {
    query: vi.fn(),
  };
}

describe('WorkflowRedriveService', () => {
  let pool: ReturnType<typeof createPool>;
  let workflowService: {
    createWorkflow: ReturnType<typeof vi.fn>;
  };
  let inputPacketService: {
    createWorkflowInputPacket: ReturnType<typeof vi.fn>;
  };
  let eventService: {
    emit: ReturnType<typeof vi.fn>;
  };
  let service: WorkflowRedriveService;

  beforeEach(() => {
    pool = createPool();
    workflowService = {
      createWorkflow: vi.fn(),
    };
    inputPacketService = {
      createWorkflowInputPacket: vi.fn(),
    };
    eventService = {
      emit: vi.fn(),
    };
    service = new WorkflowRedriveService(
      pool as never,
      workflowService as never,
      inputPacketService as never,
      eventService as never,
    );
  });

  it('creates a linked new workflow attempt and optional redrive input packet', async () => {
    pool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: 'workflow-1',
        state: 'failed',
        workspace_id: 'workspace-1',
        playbook_id: 'playbook-1',
        name: 'Release workflow',
        parameters: { target: 'production' },
        context: { launch: { trigger: 'mission_control' } },
        metadata: { model_overrides: { developer: { provider: 'openai', model: 'gpt-5.4' } } },
        attempt_group_id: 'attempt-group-1',
        root_workflow_id: null,
        previous_attempt_workflow_id: null,
        attempt_number: 1,
        attempt_kind: 'initial',
        redrive_reason: null,
        redrive_input_packet_id: null,
        inherited_input_packet_ids_json: ['packet-launch-1'],
        live_visibility_mode_override: 'standard',
      }],
    });

    workflowService.createWorkflow.mockResolvedValue({
      id: 'workflow-2',
      name: 'Release workflow retry',
    });
    inputPacketService.createWorkflowInputPacket.mockResolvedValue({
      id: 'packet-1',
    });

    const result = await service.redriveWorkflow(IDENTITY as never, 'workflow-1', {
      requestId: 'request-1',
      name: 'Release workflow retry',
      reason: 'Verification failed after stale rollback instructions.',
      summary: 'Retry with corrected deployment inputs',
      steeringInstruction: 'Focus on the verification path first.',
      parameters: { target: 'staging' },
      structuredInputs: { ticket: 'INC-42' },
      inheritancePolicy: 'inherit_all',
      redriveInputPacketId: 'packet-redrive-source-1',
      files: [
        {
          fileName: 'checklist.txt',
          contentBase64: Buffer.from('checklist').toString('base64'),
          contentType: 'text/plain',
        },
      ],
    });

    expect(workflowService.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        playbook_id: 'playbook-1',
        workspace_id: 'workspace-1',
        name: 'Release workflow retry',
        parameters: { target: 'staging' },
        attempt: {
          attempt_group_id: 'attempt-group-1',
          root_workflow_id: 'workflow-1',
          previous_attempt_workflow_id: 'workflow-1',
          attempt_number: 2,
          attempt_kind: 'redrive',
        },
        context: expect.objectContaining({
          launch: { trigger: 'mission_control' },
          redrive: expect.objectContaining({
            source_workflow_id: 'workflow-1',
            attempt_number: 2,
            summary: 'Retry with corrected deployment inputs',
            steering_instruction: 'Focus on the verification path first.',
          }),
        }),
        metadata: expect.objectContaining({
          model_overrides: { developer: { provider: 'openai', model: 'gpt-5.4' } },
          redrive_reason: 'Verification failed after stale rollback instructions.',
          redrive_input_packet_id: 'packet-redrive-source-1',
          inherited_input_packet_ids: ['packet-launch-1'],
          inheritance_policy: 'inherit_all',
        }),
        live_visibility_mode: 'standard',
      }),
    );
    expect(inputPacketService.createWorkflowInputPacket).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-2',
      expect.objectContaining({
        requestId: 'request-1',
        packetKind: 'redrive_patch',
        sourceAttemptId: 'workflow-1',
        summary: 'Retry with corrected deployment inputs',
        structuredInputs: { ticket: 'INC-42' },
      }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        type: 'workflow.redriven',
        entityType: 'workflow',
        entityId: 'workflow-2',
        data: expect.objectContaining({
          source_workflow_id: 'workflow-1',
          attempt_number: 2,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        source_workflow_id: 'workflow-1',
        attempt_number: 2,
        redrive_lineage: expect.objectContaining({
          attempt_group_id: 'attempt-group-1',
          attempt_number: 2,
          source_workflow_id: 'workflow-1',
          redrive_reason: 'Verification failed after stale rollback instructions.',
          redrive_input_packet_id: 'packet-redrive-source-1',
          inherited_input_packet_ids: ['packet-launch-1'],
        }),
        workflow: expect.objectContaining({ id: 'workflow-2' }),
        input_packet: expect.objectContaining({ id: 'packet-1' }),
      }),
    );
  });

  it('rejects redrive when the source workflow does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(
      service.redriveWorkflow(IDENTITY as never, 'workflow-missing', {
        summary: 'Retry missing workflow',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects redrive when the source workflow is not terminal', async () => {
    pool.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: 'workflow-1',
        state: 'active',
        workspace_id: 'workspace-1',
        playbook_id: 'playbook-1',
        name: 'Release workflow',
        parameters: {},
        context: {},
        metadata: {},
        attempt_group_id: 'attempt-group-1',
        root_workflow_id: null,
        previous_attempt_workflow_id: null,
        attempt_number: 1,
        attempt_kind: 'initial',
        redrive_reason: null,
        redrive_input_packet_id: null,
        inherited_input_packet_ids_json: [],
        live_visibility_mode_override: 'standard',
      }],
    });

    await expect(
      service.redriveWorkflow(IDENTITY as never, 'workflow-1', {
        reason: 'Retry this active workflow',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
