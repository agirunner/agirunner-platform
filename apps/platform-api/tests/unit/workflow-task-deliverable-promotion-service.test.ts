import { describe, expect, it, vi } from 'vitest';

import { WorkflowTaskDeliverablePromotionService } from '../../src/services/workflow-task-deliverable-promotion-service.js';

describe('WorkflowTaskDeliverablePromotionService', () => {
  it('promotes a delivery handoff without artifacts into a canonical inline-summary work-item deliverable', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 'descriptor-1' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ title: 'workflows-intake-01' }],
          rowCount: 1,
        }),
    };
    const deliverableService = {
      upsertSystemDeliverable: vi.fn(async () => ({
        descriptor_id: 'descriptor-1',
      })),
    };

    const service = new WorkflowTaskDeliverablePromotionService(
      pool as never,
      deliverableService as never,
    );

    await service.promoteFromHandoff('tenant-1', {
      id: 'handoff-1',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      task_id: 'task-1',
      role: 'intake-analyst',
      summary: 'Prepared the workflows-intake-01 triage packet for policy assessment.',
      completion: 'full',
      completion_state: 'full',
      role_data: {
        task_kind: 'delivery',
      },
      artifact_ids: [],
      created_at: '2026-03-28T20:20:00.000Z',
    });

    expect(deliverableService.upsertSystemDeliverable).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      expect.objectContaining({
        descriptorId: 'descriptor-1',
        workItemId: 'work-item-1',
        descriptorKind: 'handoff_packet',
        title: 'workflows-intake-01 completion packet',
        primaryTarget: expect.objectContaining({
          target_kind: 'inline_summary',
        }),
      }),
    );
  });

  it('promotes an artifact-backed delivery handoff into a canonical packet that points at the artifact', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
        })
        .mockResolvedValueOnce({
          rows: [{ title: 'workflows-intake-02' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'artifact-1',
            task_id: 'task-2',
            logical_path: 'artifact:workflow/output/workflows-intake-02-triage-packet.md',
            content_type: 'text/markdown',
          }],
          rowCount: 1,
        }),
    };
    const deliverableService = {
      upsertSystemDeliverable: vi.fn(async () => ({
        descriptor_id: 'descriptor-2',
      })),
    };

    const service = new WorkflowTaskDeliverablePromotionService(
      pool as never,
      deliverableService as never,
    );

    await service.promoteFromHandoff('tenant-1', {
      id: 'handoff-2',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-2',
      task_id: 'task-2',
      role: 'intake-analyst',
      summary: 'Prepared and uploaded the workflows-intake-02 triage packet for policy assessment.',
      completion: 'full',
      completion_state: 'full',
      role_data: {
        task_kind: 'delivery',
      },
      artifact_ids: ['artifact-1'],
      created_at: '2026-03-28T20:25:00.000Z',
    });

    expect(deliverableService.upsertSystemDeliverable).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      expect.objectContaining({
        workItemId: 'work-item-2',
        descriptorKind: 'handoff_packet',
        primaryTarget: expect.objectContaining({
          target_kind: 'artifact',
          artifact_id: 'artifact-1',
          path: 'artifact:workflow/output/workflows-intake-02-triage-packet.md',
        }),
        previewCapabilities: expect.objectContaining({
          can_inline_preview: true,
          can_download: true,
        }),
      }),
    );
  });

  it('does not promote non-delivery handoffs into deliverables', async () => {
    const pool = {
      query: vi.fn(),
    };
    const deliverableService = {
      upsertSystemDeliverable: vi.fn(),
    };

    const service = new WorkflowTaskDeliverablePromotionService(
      pool as never,
      deliverableService as never,
    );

    const result = await service.promoteFromHandoff('tenant-1', {
      id: 'handoff-3',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-3',
      task_id: 'task-3',
      role: 'policy-assessor',
      summary: 'Approved the intake packet.',
      completion: 'full',
      completion_state: 'full',
      role_data: {
        task_kind: 'assessment',
      },
      artifact_ids: [],
      created_at: '2026-03-28T20:30:00.000Z',
    });

    expect(result).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
    expect(deliverableService.upsertSystemDeliverable).not.toHaveBeenCalled();
  });
});
