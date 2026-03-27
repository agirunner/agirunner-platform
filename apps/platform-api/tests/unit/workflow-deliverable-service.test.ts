import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverableService } from '../../src/services/workflow-deliverable-service.js';

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

describe('WorkflowDeliverableService', () => {
  let pool: ReturnType<typeof createPool>;
  let service: WorkflowDeliverableService;

  beforeEach(() => {
    pool = createPool();
    service = new WorkflowDeliverableService(pool as never);
  });

  it('upserts in-progress and final deliverables with typed preview and target contracts', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_operator_briefs')) {
        return { rowCount: 1, rows: [{ id: 'brief-1' }] };
      }
      if (sql.includes('FROM workflow_output_descriptors')) {
        return { rowCount: 1, rows: [{ id: 'descriptor-1' }] };
      }
      if (sql.includes('UPDATE workflow_output_descriptors')) {
        expect(params?.[1]).toBe('final');
        expect(params?.[2]).toBe('Release notes');
        expect(params?.[3]).toBe('final');
        expect(params?.[4]).toBe('Final release notes approved.');
        expect(params?.[5]).toEqual({
          can_inline_preview: true,
          can_download: true,
          can_open_external: false,
          can_copy_path: false,
          preview_kind: 'markdown',
        });
        expect(params?.[6]).toEqual({
          target_kind: 'artifact',
          label: 'Download release notes',
          url: 'https://example.invalid/artifact/1',
        });
        expect(params?.[7]).toEqual([
          {
            target_kind: 'workspace_doc',
            label: 'Open source document',
            url: 'https://example.invalid/doc/1',
          },
        ]);
        expect(params?.[8]).toEqual({
          preview_text: '## Release Notes',
        });
        return {
          rowCount: 1,
          rows: [{
            id: 'descriptor-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            descriptor_kind: 'artifact',
            delivery_stage: 'final',
            title: 'Release notes',
            state: 'final',
            summary_brief: 'Final release notes approved.',
            preview_capabilities_json: params?.[5],
            primary_target_json: params?.[6],
            secondary_targets_json: params?.[7],
            content_preview_json: params?.[8],
            source_brief_id: 'brief-1',
            created_at: new Date('2026-03-27T17:00:00.000Z'),
            updated_at: new Date('2026-03-27T17:05:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.upsertDeliverable(IDENTITY as never, 'workflow-1', {
      descriptorId: 'descriptor-1',
      descriptorKind: 'artifact',
      deliveryStage: 'final',
      title: 'Release notes',
      state: 'final',
      summaryBrief: 'Final release notes approved.',
      previewCapabilities: {
        can_inline_preview: true,
        can_download: true,
        can_open_external: false,
        can_copy_path: false,
        preview_kind: 'markdown',
      },
      primaryTarget: {
        target_kind: 'artifact',
        label: 'Download release notes',
        url: 'https://example.invalid/artifact/1',
      },
      secondaryTargets: [
        {
          target_kind: 'workspace_doc',
          label: 'Open source document',
          url: 'https://example.invalid/doc/1',
        },
      ],
      contentPreview: {
        preview_text: '## Release Notes',
      },
      sourceBriefId: 'brief-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        descriptor_id: 'descriptor-1',
        workflow_id: 'workflow-1',
        delivery_stage: 'final',
        state: 'final',
        summary_brief: 'Final release notes approved.',
      }),
    );
  });
});
