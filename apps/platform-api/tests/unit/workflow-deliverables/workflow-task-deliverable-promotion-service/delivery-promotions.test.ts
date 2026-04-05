import { describe, expect, it, vi } from 'vitest';

import {
  createArtifactRow,
  createDeliverableService,
  createService,
  createWorkItemRow,
} from './support.js';

describe('WorkflowTaskDeliverablePromotionService delivery promotions', () => {
  it('promotes a delivery handoff without artifacts into a canonical inline-summary work-item deliverable', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflow_output_descriptors')) {
          expect(sql).toContain("descriptor_kind IN ('deliverable_packet', 'handoff_packet')");
          return { rows: [{ id: 'descriptor-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_work_items')) {
          return { rows: [createWorkItemRow('workflows-intake-01')], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const deliverableService = createDeliverableService();
    const service = createService(pool, deliverableService);

    await service.promoteFromHandoff('tenant-1', {
      id: 'handoff-1',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-1',
      task_id: 'task-1',
      role: 'intake-analyst',
      summary: 'Prepared the workflows-intake-01 triage packet for policy assessment.',
      completion: 'full',
      completion_state: 'full',
      role_data: { task_kind: 'delivery' },
      artifact_ids: [],
      created_at: '2026-03-28T20:20:00.000Z',
    });

    const promotionInput = (deliverableService.upsertSystemDeliverable.mock.calls as unknown as Array<
      [string, string, { primaryTarget?: Record<string, unknown>; contentPreview?: Record<string, unknown> }]
    >)[0]?.[2];
    expect(deliverableService.upsertSystemDeliverable).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      expect.objectContaining({
        descriptorId: 'descriptor-1',
        workItemId: 'work-item-1',
        descriptorKind: 'deliverable_packet',
        title: 'workflows-intake-01 completion packet',
        primaryTarget: expect.objectContaining({
          target_kind: 'inline_summary',
        }),
      }),
    );
    expect(promotionInput?.primaryTarget).not.toHaveProperty('url');
    expect(promotionInput?.contentPreview).toEqual(
      expect.objectContaining({
        source_role_name: 'Intake Analyst',
      }),
    );
  });

  it('promotes an artifact-backed delivery handoff into a canonical packet that points at the artifact', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'artifact-1',
              task_id: 'task-2',
              logical_path: 'artifact:workflow/output/workflows-intake-02-triage-packet.md',
              content_type: 'text/markdown',
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [createWorkItemRow('workflows-intake-02')], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };
    const deliverableService = createDeliverableService();
    const service = createService(pool, deliverableService);

    await service.promoteFromHandoff('tenant-1', {
      id: 'handoff-2',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-2',
      task_id: 'task-2',
      role: 'intake-analyst',
      summary: 'Prepared and uploaded the workflows-intake-02 triage packet for policy assessment.',
      completion: 'full',
      completion_state: 'full',
      role_data: { task_kind: 'delivery' },
      artifact_ids: ['artifact-1'],
      created_at: '2026-03-28T20:25:00.000Z',
    });

    expect(deliverableService.upsertSystemDeliverable).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      expect.objectContaining({
        descriptorId: 'handoff-2',
        workItemId: 'work-item-2',
        descriptorKind: 'deliverable_packet',
        primaryTarget: expect.objectContaining({
          target_kind: 'artifact',
          artifact_id: 'artifact-1',
          url: '/api/v1/tasks/task-2/artifacts/artifact-1/preview',
          path: 'artifact:workflow/output/workflows-intake-02-triage-packet.md',
        }),
        previewCapabilities: expect.objectContaining({
          can_inline_preview: true,
          can_download: true,
        }),
        contentPreview: expect.objectContaining({
          source_role_name: 'Intake Analyst',
        }),
      }),
    );
  });

  it('marks artifact-backed canonical deliverables as durable after promotion', async () => {
    const artifactId = '13e16b95-b515-4112-8f2e-46dae3e1e532';
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_work_items')) {
          return { rows: [createWorkItemRow('research-synthesis')], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_artifacts')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', [artifactId]]);
          return {
            rows: [
              createArtifactRow({
                id: artifactId,
                task_id: 'task-2',
                logical_path: 'artifact:workflow/output/research-synthesis.md',
              }),
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('UPDATE workflow_artifacts')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', [artifactId]]);
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const deliverableService = createDeliverableService();
    const service = createService(pool, deliverableService);

    await service.promoteFromHandoff('tenant-1', {
      id: 'handoff-3',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-3',
      task_id: 'task-2',
      role: 'research-analyst',
      summary: 'Published the final research synthesis artifact.',
      completion: 'full',
      completion_state: 'full',
      role_data: { task_kind: 'delivery' },
      artifact_ids: [artifactId],
      created_at: '2026-03-28T20:30:00.000Z',
    });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_artifacts'),
      ['tenant-1', 'workflow-1', [artifactId]],
    );
  });

  it('keeps distinct artifact-backed handoffs on the same work item as separate deliverables', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_artifacts')) {
          expect(params).toEqual(
            expect.arrayContaining(['tenant-1', 'workflow-1']),
          );
          const artifactIds = Array.isArray(params?.[2]) ? params[2] : [];
          if (artifactIds[0] === 'artifact-security') {
            return {
              rows: [
                createArtifactRow({
                  id: 'artifact-security',
                  task_id: 'task-security',
                  logical_path: 'artifact:workflow/output/security-review.md',
                }),
              ],
              rowCount: 1,
            };
          }
          if (artifactIds[0] === 'artifact-qa') {
            return {
              rows: [
                createArtifactRow({
                  id: 'artifact-qa',
                  task_id: 'task-qa',
                  logical_path: 'artifact:workflow/output/qa-review.md',
                }),
              ],
              rowCount: 1,
            };
          }
        }
        if (sql.includes('FROM workflow_work_items')) {
          return { rows: [createWorkItemRow('risk-check-output')], rowCount: 1 };
        }
        if (sql.includes('UPDATE workflow_artifacts')) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const deliverableService = createDeliverableService();
    const service = createService(pool, deliverableService);

    await service.promoteFromHandoff('tenant-1', {
      id: 'handoff-security',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-risk',
      task_id: 'task-security',
      role: 'security-reviewer',
      summary: 'Uploaded the security review packet.',
      completion: 'full',
      completion_state: 'full',
      role_data: { task_kind: 'analysis' },
      artifact_ids: ['artifact-security'],
      created_at: '2026-03-28T20:40:00.000Z',
    });

    await service.promoteFromHandoff('tenant-1', {
      id: 'handoff-qa',
      workflow_id: 'workflow-1',
      work_item_id: 'work-item-risk',
      task_id: 'task-qa',
      role: 'qa-reviewer',
      summary: 'Uploaded the QA review packet.',
      completion: 'full',
      completion_state: 'full',
      role_data: { task_kind: 'analysis' },
      artifact_ids: ['artifact-qa'],
      created_at: '2026-03-28T20:45:00.000Z',
    });

    expect(deliverableService.upsertSystemDeliverable).toHaveBeenNthCalledWith(
      1,
      'tenant-1',
      'workflow-1',
      expect.objectContaining({
        descriptorId: 'handoff-security',
        workItemId: 'work-item-risk',
        primaryTarget: expect.objectContaining({
          artifact_id: 'artifact-security',
        }),
      }),
    );
    expect(deliverableService.upsertSystemDeliverable).toHaveBeenNthCalledWith(
      2,
      'tenant-1',
      'workflow-1',
      expect.objectContaining({
        descriptorId: 'handoff-qa',
        workItemId: 'work-item-risk',
        primaryTarget: expect.objectContaining({
          artifact_id: 'artifact-qa',
        }),
      }),
    );
  });

  it('resolves the parent work item from the task when the handoff omits work-item linkage', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-5']);
          return { rows: [{ work_item_id: 'work-item-5' }], rowCount: 1 };
        }
        if (sql.includes('FROM workflow_output_descriptors')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-5']);
          return { rows: [createWorkItemRow('workflow-intake-05')], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const deliverableService = createDeliverableService();
    const service = createService(pool, deliverableService);

    await service.promoteFromHandoff('tenant-1', {
      id: 'handoff-5',
      workflow_id: 'workflow-1',
      work_item_id: null,
      task_id: 'task-5',
      role: 'builder',
      summary: 'Published the final workflow-intake-05 packet artifact.',
      completion: 'full',
      completion_state: 'full',
      role_data: { task_kind: 'delivery' },
      artifact_ids: [],
      created_at: '2026-03-28T20:55:00.000Z',
    });

    expect(deliverableService.upsertSystemDeliverable).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      expect.objectContaining({
        workItemId: 'work-item-5',
        title: 'workflow-intake-05 completion packet',
      }),
    );
  });
});
