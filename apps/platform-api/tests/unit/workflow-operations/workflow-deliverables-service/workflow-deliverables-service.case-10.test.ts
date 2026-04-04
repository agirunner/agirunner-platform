import { describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverablesService } from '../../../../src/services/workflow-operations/workflow-deliverables-service.js';

describe('WorkflowDeliverablesService', () => {
  it('collapses workflow-scope duplicates when review and rollup rows point at the same artifact', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'report-draft-rollup',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Report Draft',
          state: 'final',
          summary_brief: 'Analyst draft handoff for report-draft.md.',
          preview_capabilities: {
            can_inline_preview: true,
            can_download: true,
            can_open_external: false,
            can_copy_path: true,
            preview_kind: 'markdown',
          },
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            path: 'artifact:workflow-1/report-draft.md',
            artifact_id: 'artifact-report-draft',
            url: '/api/v1/tasks/task-draft/artifacts/artifact-report-draft/preview',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Analyst draft handoff for report-draft.md.',
            source_role_name: 'Research Analyst',
            rollup_source_work_item_id: 'work-item-draft',
            rollup_source_descriptor_id: 'report-draft-source',
          },
          source_brief_id: null,
          created_at: '2026-04-04T10:44:00.288Z',
          updated_at: '2026-04-04T10:44:00.288Z',
        },
        {
          descriptor_id: 'report-draft-review',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-review',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Report Draft',
          state: 'final',
          summary_brief: 'Reviewer approved the current report-draft.md revision.',
          preview_capabilities: {
            can_inline_preview: true,
            can_download: true,
            can_open_external: false,
            can_copy_path: true,
            preview_kind: 'markdown',
          },
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            path: 'artifact:workflow-1/report-draft.md',
            artifact_id: 'artifact-report-draft',
            url: '/api/v1/tasks/task-draft/artifacts/artifact-report-draft/preview',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Reviewer approved the current report-draft.md revision.',
            source_role_name: 'Research Reviewer',
          },
          source_brief_id: null,
          created_at: '2026-04-04T10:45:17.139Z',
          updated_at: '2026-04-04T10:45:17.139Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };
    const workItemSource = {
      listIncompleteWorkItemIds: vi.fn(async () => []),
      listExistingWorkItemIds: vi.fn(async () => []),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
      undefined,
      workItemSource as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1');

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'report-draft-review',
        work_item_id: 'work-item-review',
        title: 'Report Draft',
        summary_brief: 'Reviewer approved the current report-draft.md revision.',
        content_preview: expect.objectContaining({
          source_role_name: 'Research Reviewer',
        }),
      }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
    expect(result.all_deliverables).toEqual(result.final_deliverables);
  });
});
