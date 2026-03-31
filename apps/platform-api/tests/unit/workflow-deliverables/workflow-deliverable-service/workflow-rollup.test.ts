import { beforeEach, describe, expect, it } from 'vitest';

import { IDENTITY, createService } from './support.js';

describe('WorkflowDeliverableService workflow rollups', () => {
  let pool: ReturnType<typeof createService>['pool'];
  let service: ReturnType<typeof createService>['service'];

  beforeEach(() => {
    ({ pool, service } = createService());
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
