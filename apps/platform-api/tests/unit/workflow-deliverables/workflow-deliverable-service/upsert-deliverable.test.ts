import { beforeEach, describe, expect, it } from 'vitest';

import { IDENTITY, createService } from './support.js';

describe('WorkflowDeliverableService upsertDeliverable', () => {
  let pool: ReturnType<typeof createService>['pool'];
  let service: ReturnType<typeof createService>['service'];

  beforeEach(() => {
    ({ pool, service } = createService());
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
        expect(params?.[5]).toBe(JSON.stringify({
          can_inline_preview: true,
          can_download: true,
          can_open_external: false,
          can_copy_path: false,
          preview_kind: 'markdown',
        }));
        expect(params?.[6]).toBe(JSON.stringify({
          target_kind: 'artifact',
          label: 'Download release notes',
          url: 'https://example.invalid/artifact/1',
        }));
        expect(params?.[7]).toBe(JSON.stringify([
          {
            target_kind: 'workspace_doc',
            label: 'Open source document',
            url: 'https://example.invalid/doc/1',
          },
        ]));
        expect(params?.[8]).toBe(JSON.stringify({
          preview_text: '## Release Notes',
        }));
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
            preview_capabilities_json: JSON.parse(String(params?.[5])),
            primary_target_json: JSON.parse(String(params?.[6])),
            secondary_targets_json: JSON.parse(String(params?.[7])),
            content_preview_json: JSON.parse(String(params?.[8])),
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

  it('serializes non-empty secondary targets as JSON instead of a postgres array literal', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_work_items')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
        return { rowCount: 1, rows: [{ id: 'work-item-1' }] };
      }
      if (sql.includes('FROM workflow_output_descriptors')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO workflow_output_descriptors')) {
        expect(params?.[7]).toBe(
          JSON.stringify([
            {
              target_kind: 'artifact',
              label: 'Supporting artifact',
              url: 'https://example.invalid/artifact/2',
              artifact_id: 'artifact-2',
            },
          ]),
        );
        return {
          rowCount: 1,
          rows: [{
            id: 'descriptor-2',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'deliverable_packet',
            delivery_stage: 'final',
            title: 'Release packet',
            state: 'final',
            summary_brief: 'Release packet is ready.',
            preview_capabilities_json: JSON.parse(String(params?.[5])),
            primary_target_json: JSON.parse(String(params?.[6])),
            secondary_targets_json: JSON.parse(String(params?.[7])),
            content_preview_json: JSON.parse(String(params?.[8])),
            source_brief_id: null,
            created_at: new Date('2026-03-29T00:00:00.000Z'),
            updated_at: new Date('2026-03-29T00:00:00.000Z'),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.upsertSystemDeliverable('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      descriptorKind: 'deliverable_packet',
      deliveryStage: 'final',
      title: 'Release packet',
      state: 'final',
      summaryBrief: 'Release packet is ready.',
      primaryTarget: {
        target_kind: 'artifact',
        label: 'Open artifact',
        url: 'https://example.invalid/artifact/1',
        artifact_id: 'artifact-1',
      },
      secondaryTargets: [
        {
          target_kind: 'artifact',
          label: 'Supporting artifact',
          url: 'https://example.invalid/artifact/2',
          artifact_id: 'artifact-2',
        },
      ],
      contentPreview: {
        summary: 'Release packet is ready.',
      },
    });

    expect(result.secondary_targets).toEqual([
      expect.objectContaining({
        artifact_id: 'artifact-2',
        target_kind: 'artifact',
      }),
    ]);
  });

  it('accepts inline-summary deliverables without a target url', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_output_descriptors')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO workflow_output_descriptors')) {
        expect(params?.[5]).toBe(JSON.stringify({
          can_inline_preview: true,
          can_download: false,
          can_open_external: false,
          can_copy_path: false,
          preview_kind: 'structured_summary',
        }));
        expect(params?.[6]).toBe(JSON.stringify({
          target_kind: 'inline_summary',
          label: 'Review completion packet',
        }));
        return {
          rowCount: 1,
          rows: [{
            id: 'descriptor-inline-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            descriptor_kind: 'handoff_packet',
            delivery_stage: 'final',
            title: 'Work item completion packet',
            state: 'final',
            summary_brief: 'Final completion summary.',
            preview_capabilities_json: JSON.parse(String(params?.[5])),
            primary_target_json: JSON.parse(String(params?.[6])),
            secondary_targets_json: JSON.parse(String(params?.[7])),
            content_preview_json: JSON.parse(String(params?.[8])),
            source_brief_id: null,
            created_at: new Date('2026-03-28T18:00:00.000Z'),
            updated_at: new Date('2026-03-28T18:00:00.000Z'),
          }],
        };
      }
      if (sql.includes('FROM workflow_work_items')) {
        return { rowCount: 1, rows: [{ id: 'work-item-1' }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.upsertDeliverable(IDENTITY as never, 'workflow-1', {
      workItemId: 'work-item-1',
      descriptorKind: 'handoff_packet',
      deliveryStage: 'final',
      title: 'Work item completion packet',
      state: 'final',
      summaryBrief: 'Final completion summary.',
      previewCapabilities: {
        can_inline_preview: true,
        can_download: false,
        can_open_external: false,
        can_copy_path: false,
        preview_kind: 'structured_summary',
      },
      primaryTarget: {
        target_kind: 'inline_summary',
        label: 'Review completion packet',
      },
      contentPreview: {
        summary: 'Final completion summary.',
      },
    });

    expect(result.primary_target).toEqual({
      target_kind: 'inline_summary',
      label: 'Review completion packet',
    });
  });
});
