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

  it('lists workflow deliverables newest first with optional work-item filtering', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_output_descriptors')) {
        expect(sql).toContain('LIMIT $4');
        expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1', 2]);
        return {
          rowCount: 2,
          rows: [
            {
              id: 'descriptor-2',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              descriptor_kind: 'artifact',
              delivery_stage: 'final',
              title: 'Release package',
              state: 'final',
              summary_brief: 'Ready to ship.',
              preview_capabilities_json: {},
              primary_target_json: { label: 'artifact.zip', url: 'https://example.invalid/artifact.zip' },
              secondary_targets_json: [],
              content_preview_json: {},
              source_brief_id: null,
              created_at: new Date('2026-03-27T18:00:00.000Z'),
              updated_at: new Date('2026-03-27T18:00:00.000Z'),
            },
            {
              id: 'descriptor-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              descriptor_kind: 'repo',
              delivery_stage: 'in_progress',
              title: 'Verification branch',
              state: 'draft',
              summary_brief: 'Waiting on approval.',
              preview_capabilities_json: {},
              primary_target_json: { label: 'feature/release', url: 'https://example.invalid/repo' },
              secondary_targets_json: [],
              content_preview_json: {},
              source_brief_id: null,
              created_at: new Date('2026-03-27T17:00:00.000Z'),
              updated_at: new Date('2026-03-27T17:00:00.000Z'),
            },
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.listDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      limit: 2,
    });

    expect(result.map((entry) => entry.descriptor_id)).toEqual(['descriptor-2', 'descriptor-1']);
  });

  it('queries workflow scope using only workflow-level descriptors', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_output_descriptors')) {
        expect(sql).toContain('AND work_item_id IS NULL');
        expect(sql).toContain('LIMIT $3');
        expect(params).toEqual(['tenant-1', 'workflow-1', 50]);
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await service.listDeliverables('tenant-1', 'workflow-1');
  });

  it('queries workflow scope with work-item rollup when requested', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_output_descriptors')) {
        expect(sql).not.toContain('work_item_id IS NULL');
        expect(sql).toContain('LIMIT $3');
        expect(params).toEqual(['tenant-1', 'workflow-1', 50]);
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await service.listDeliverables('tenant-1', 'workflow-1', {
      includeAllWorkItemScopes: true,
    });
  });

  it('queries selected work-item scope with workflow-level rollup when requested', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_output_descriptors')) {
        expect(sql).toContain('AND (work_item_id = $3 OR work_item_id IS NULL)');
        expect(sql).toContain('LIMIT $4');
        expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1', 50]);
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await service.listDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      includeWorkflowScope: true,
    });
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

  it('creates a workflow-scoped rollup descriptor only after the source work item is completed', async () => {
    const sourceDeliverableRow = {
      id: 'descriptor-work-item-1',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      descriptor_kind: 'deliverable_packet',
      delivery_stage: 'final',
      title: 'Implementation pass completion packet',
      state: 'final',
      summary_brief: 'Implementation is complete and ready for workflow review.',
      preview_capabilities_json: {
        can_inline_preview: true,
        can_download: false,
        can_open_external: false,
        can_copy_path: false,
        preview_kind: 'structured_summary',
      },
      primary_target_json: {
        target_kind: 'inline_summary',
        label: 'Review completion packet',
      },
      secondary_targets_json: [],
      content_preview_json: {
        summary: 'Implementation is complete and ready for workflow review.',
      },
      source_brief_id: null,
      created_at: new Date('2026-03-29T09:00:00.000Z'),
      updated_at: new Date('2026-03-29T09:01:00.000Z'),
    };
    const workflowRollupRow = {
      ...sourceDeliverableRow,
      id: '9b6b726d-baf0-4dc2-85b8-0c8f8770fcb3',
      work_item_id: null,
      content_preview_json: {
        summary: 'Implementation is complete and ready for workflow review.',
        rollup_source_descriptor_id: 'descriptor-work-item-1',
        rollup_source_work_item_id: 'work-item-1',
      },
    };

    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_work_items')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
        return {
          rowCount: 1,
          rows: [{ id: 'work-item-1', completed_at: new Date('2026-03-29T09:02:00.000Z') }],
        };
      }
      if (sql.includes("content_preview_json->>'rollup_source_descriptor_id' = $3")) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'descriptor-work-item-1']);
        return { rowCount: 0, rows: [] };
      }
      if (
        sql.includes('FROM workflow_output_descriptors')
        && sql.includes('WHERE tenant_id = $1')
        && sql.includes('AND workflow_id = $2')
        && sql.includes('AND id = $3')
      ) {
        if (params?.[2] === 'descriptor-work-item-1') {
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO workflow_output_descriptors')) {
        if (params?.[13] === 'descriptor-work-item-1') {
          return { rowCount: 1, rows: [sourceDeliverableRow] };
        }
        expect(params?.[11]).toBeNull();
        expect(String(params?.[13])).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
        expect(params?.[8]).toBe(JSON.stringify({
          summary: 'Implementation is complete and ready for workflow review.',
          rollup_source_descriptor_id: 'descriptor-work-item-1',
          rollup_source_work_item_id: 'work-item-1',
        }));
        return { rowCount: 1, rows: [workflowRollupRow] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.upsertDeliverable(IDENTITY as never, 'workflow-1', {
      descriptorId: 'descriptor-work-item-1',
      workItemId: 'work-item-1',
      descriptorKind: 'deliverable_packet',
      deliveryStage: 'final',
      title: 'Implementation pass completion packet',
      state: 'final',
      summaryBrief: 'Implementation is complete and ready for workflow review.',
      primaryTarget: {
        target_kind: 'inline_summary',
        label: 'Review completion packet',
      },
      contentPreview: {
        summary: 'Implementation is complete and ready for workflow review.',
      },
    });

    expect(result).toEqual(expect.objectContaining({
      descriptor_id: 'descriptor-work-item-1',
      work_item_id: 'work-item-1',
    }));
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("content_preview_json->>'rollup_source_descriptor_id' = $3"),
      ['tenant-1', 'workflow-1', 'descriptor-work-item-1'],
    );
  });

  it('does not create a workflow-scoped rollup descriptor while the source work item is still incomplete', async () => {
    const sourceDeliverableRow = {
      id: 'descriptor-work-item-2',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-2',
      descriptor_kind: 'deliverable_packet',
      delivery_stage: 'final',
      title: 'Implementation pass completion packet',
      state: 'final',
      summary_brief: 'Implementation is complete and ready for workflow review.',
      preview_capabilities_json: {
        can_inline_preview: true,
        can_download: false,
        can_open_external: false,
        can_copy_path: false,
        preview_kind: 'structured_summary',
      },
      primary_target_json: {
        target_kind: 'inline_summary',
        label: 'Review completion packet',
      },
      secondary_targets_json: [],
      content_preview_json: {
        summary: 'Implementation is complete and ready for workflow review.',
      },
      source_brief_id: null,
      created_at: new Date('2026-03-29T09:00:00.000Z'),
      updated_at: new Date('2026-03-29T09:01:00.000Z'),
    };

    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_work_items')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-2']);
        return {
          rowCount: 1,
          rows: [{ id: 'work-item-2', completed_at: null }],
        };
      }
      if (
        sql.includes('FROM workflow_output_descriptors')
        && sql.includes('WHERE tenant_id = $1')
        && sql.includes('AND workflow_id = $2')
        && sql.includes('AND id = $3')
      ) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("content_preview_json->>'rollup_source_descriptor_id' = $3")) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'descriptor-work-item-2']);
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO workflow_output_descriptors')) {
        expect(params?.[13]).toBe('descriptor-work-item-2');
        return { rowCount: 1, rows: [sourceDeliverableRow] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.upsertDeliverable(IDENTITY as never, 'workflow-1', {
      descriptorId: 'descriptor-work-item-2',
      workItemId: 'work-item-2',
      descriptorKind: 'deliverable_packet',
      deliveryStage: 'final',
      title: 'Implementation pass completion packet',
      state: 'final',
      summaryBrief: 'Implementation is complete and ready for workflow review.',
      primaryTarget: {
        target_kind: 'inline_summary',
        label: 'Review completion packet',
      },
      contentPreview: {
        summary: 'Implementation is complete and ready for workflow review.',
      },
    });

    expect(result).toEqual(expect.objectContaining({
      descriptor_id: 'descriptor-work-item-2',
      work_item_id: 'work-item-2',
    }));
    expect(
      pool.query.mock.calls.filter(
        ([sql, params]) =>
          typeof sql === 'string'
          && sql.includes('INSERT INTO workflow_output_descriptors')
          && Array.isArray(params)
          && params[11] === null,
      ),
    ).toEqual([]);
  });

  it('reconciles workflow-scoped rollup descriptors after the work item completes later', async () => {
    const sourceDeliverableRow = {
      id: 'descriptor-work-item-3',
      tenant_id: 'tenant-1',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-3',
      descriptor_kind: 'deliverable_packet',
      delivery_stage: 'final',
      title: 'QA completion packet',
      state: 'final',
      summary_brief: 'QA is complete and ready for workflow closure.',
      preview_capabilities_json: {
        can_inline_preview: true,
        can_download: false,
        can_open_external: false,
        can_copy_path: false,
        preview_kind: 'structured_summary',
      },
      primary_target_json: {
        target_kind: 'inline_summary',
        label: 'Review QA packet',
      },
      secondary_targets_json: [],
      content_preview_json: {
        summary: 'QA is complete and ready for workflow closure.',
      },
      source_brief_id: null,
      created_at: new Date('2026-03-29T09:10:00.000Z'),
      updated_at: new Date('2026-03-29T09:11:00.000Z'),
    };
    const workflowRollupRow = {
      ...sourceDeliverableRow,
      id: '8e4c815f-6a7d-469c-8838-0aa059f3d3dd',
      work_item_id: null,
      content_preview_json: {
        summary: 'QA is complete and ready for workflow closure.',
        rollup_source_descriptor_id: 'descriptor-work-item-3',
        rollup_source_work_item_id: 'work-item-3',
      },
    };

    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        expect(params).toEqual(['tenant-1', 'workflow-1']);
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_work_items')) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-3']);
        return {
          rowCount: 1,
          rows: [{ id: 'work-item-3', completed_at: new Date('2026-03-29T09:12:00.000Z') }],
        };
      }
      if (
        sql.includes('FROM workflow_output_descriptors')
        && sql.includes('AND work_item_id = $3')
        && sql.includes("AND (delivery_stage = 'final' OR state = 'final')")
      ) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-3']);
        return { rowCount: 1, rows: [sourceDeliverableRow] };
      }
      if (sql.includes("content_preview_json->>'rollup_source_descriptor_id' = $3")) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'descriptor-work-item-3']);
        return { rowCount: 0, rows: [] };
      }
      if (
        sql.includes('FROM workflow_output_descriptors')
        && sql.includes('WHERE tenant_id = $1')
        && sql.includes('AND workflow_id = $2')
        && sql.includes('AND id = $3')
      ) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO workflow_output_descriptors')) {
        expect(params?.[11]).toBeNull();
        expect(params?.[8]).toBe(JSON.stringify({
          summary: 'QA is complete and ready for workflow closure.',
          rollup_source_descriptor_id: 'descriptor-work-item-3',
          rollup_source_work_item_id: 'work-item-3',
        }));
        return { rowCount: 1, rows: [workflowRollupRow] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await (service as any).reconcileWorkflowRollupsForCompletedWorkItem('tenant-1', 'workflow-1', 'work-item-3');

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("content_preview_json->>'rollup_source_descriptor_id' = $3"),
      ['tenant-1', 'workflow-1', 'descriptor-work-item-3'],
    );
  });
});
