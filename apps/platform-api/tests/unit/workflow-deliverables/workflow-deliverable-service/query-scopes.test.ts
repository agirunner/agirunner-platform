import { beforeEach, describe, expect, it } from 'vitest';

import { createService } from './support.js';

describe('WorkflowDeliverableService query scopes', () => {
  let pool: ReturnType<typeof createService>['pool'];
  let service: ReturnType<typeof createService>['service'];

  beforeEach(() => {
    ({ pool, service } = createService());
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

  it('removes stale artifact targets when the backing artifact row no longer exists', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_output_descriptors')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'descriptor-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              descriptor_kind: 'artifact_bundle',
              delivery_stage: 'final',
              title: 'Completion packet',
              state: 'final',
              summary_brief: 'Fallback summary remains available.',
              preview_capabilities_json: {},
              primary_target_json: {
                label: 'missing.md',
                path: 'artifact:workflow/docs/missing.md',
                artifact_id: '13e16b95-b515-4112-8f2e-46dae3e1e532',
                url: '/api/v1/tasks/task-1/artifacts/13e16b95-b515-4112-8f2e-46dae3e1e532/preview',
              },
              secondary_targets_json: [],
              content_preview_json: {
                summary: 'Fallback summary remains available.',
              },
              source_brief_id: null,
              created_at: new Date('2026-03-27T18:00:00.000Z'),
              updated_at: new Date('2026-03-27T18:00:00.000Z'),
            },
          ],
        };
      }
      if (sql.includes('FROM workflow_artifacts')) {
        expect(params).toEqual([
          'tenant-1',
          ['13e16b95-b515-4112-8f2e-46dae3e1e532'],
        ]);
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.listDeliverables('tenant-1', 'workflow-1');

    expect(result).toHaveLength(1);
    expect(result[0]?.primary_target).toEqual({});
    expect(result[0]?.summary_brief).toBe('Fallback summary remains available.');
  });
});
