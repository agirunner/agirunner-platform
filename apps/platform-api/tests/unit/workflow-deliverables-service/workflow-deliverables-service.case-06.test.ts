import { describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverablesService } from '../../../src/services/workflow-operations/workflow-deliverables-service.js';

describe('WorkflowDeliverablesService', () => {
  it('keeps final work-item deliverables visible in workflow scope even when workflow-scoped packets also exist', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-workflow-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'brief_packet',
          delivery_stage: 'in_progress',
          title: 'Workflow summary packet',
          state: 'under_review',
          summary_brief: 'Workflow review is still in progress.',
          preview_capabilities: {},
          primary_target: { target_kind: 'inline_summary', label: 'Review workflow packet' },
          secondary_targets: [],
          content_preview: {
            summary: 'Workflow review is still in progress.',
          },
          source_brief_id: 'brief-workflow-1',
          created_at: '2026-03-28T20:55:00.000Z',
          updated_at: '2026-03-28T20:55:00.000Z',
        },
        {
          descriptor_id: 'deliverable-work-item-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'workflow-intake-01 completion packet',
          state: 'final',
          summary_brief: 'Work item packet is final and ready for operator review.',
          preview_capabilities: {},
          primary_target: { target_kind: 'inline_summary', label: 'Review completion packet' },
          secondary_targets: [],
          content_preview: {
            summary: 'Work item packet is final and ready for operator review.',
          },
          source_brief_id: null,
          created_at: '2026-03-28T21:00:00.000Z',
          updated_at: '2026-03-28T21:00:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-workflow-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-workflow-1',
          execution_context_id: 'execution-workflow-1',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'in_progress',
          short_brief: { headline: 'Workflow summary packet' },
          detailed_brief_json: {
            headline: 'Workflow summary packet',
            status_kind: 'in_progress',
          },
          linked_target_ids: [],
          sequence_number: 6,
          related_artifact_ids: [],
          related_output_descriptor_ids: ['deliverable-workflow-1'],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-28T20:55:00.000Z',
          updated_at: '2026-03-28T20:55:00.000Z',
        },
      ]),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };
    const workItemSource = {
      listIncompleteWorkItemIds: vi.fn(async () => []),
      listExistingWorkItemIds: vi.fn(async () => ['work-item-2']),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
      undefined,
      workItemSource as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1');

    expect(result.final_deliverables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor_id: 'deliverable-work-item-1',
          work_item_id: 'work-item-1',
        }),
      ]),
    );
    expect(result.in_progress_deliverables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor_id: 'deliverable-workflow-1',
          work_item_id: null,
        }),
      ]),
    );
  });

  it('prefers a persisted workflow-scoped rollup descriptor over the mirrored work-item descriptor in workflow scope', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-work-item-impl',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-impl',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Implementation pass completion packet',
          state: 'final',
          summary_brief: 'Implementation is complete and ready for workflow review.',
          preview_capabilities: {},
          primary_target: { target_kind: 'inline_summary', label: 'Review completion packet' },
          secondary_targets: [],
          content_preview: {
            summary: 'Implementation is complete and ready for workflow review.',
          },
          source_brief_id: null,
          created_at: '2026-03-29T09:00:00.000Z',
          updated_at: '2026-03-29T09:01:00.000Z',
        },
        {
          descriptor_id: 'deliverable-workflow-rollup-impl',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Implementation pass completion packet',
          state: 'final',
          summary_brief: 'Implementation is complete and ready for workflow review.',
          preview_capabilities: {},
          primary_target: { target_kind: 'inline_summary', label: 'Review completion packet' },
          secondary_targets: [],
          content_preview: {
            summary: 'Implementation is complete and ready for workflow review.',
            rollup_source_descriptor_id: 'deliverable-work-item-impl',
            rollup_source_work_item_id: 'work-item-impl',
          },
          source_brief_id: null,
          created_at: '2026-03-29T09:00:30.000Z',
          updated_at: '2026-03-29T09:01:30.000Z',
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

    const workflowScope = await service.getDeliverables('tenant-1', 'workflow-1');
    expect(workflowScope.final_deliverables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor_id: 'deliverable-workflow-rollup-impl',
          work_item_id: null,
        }),
        expect.objectContaining({
          descriptor_id: 'deliverable-work-item-impl',
          work_item_id: 'work-item-impl',
        }),
      ]),
    );
    expect(workflowScope.final_deliverables).toHaveLength(2);

    const workItemScope = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-impl',
    });
    expect(workItemScope.final_deliverables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor_id: 'deliverable-work-item-impl',
          work_item_id: 'work-item-impl',
        }),
        expect.objectContaining({
          descriptor_id: 'deliverable-workflow-rollup-impl',
          work_item_id: null,
        }),
      ]),
    );
    expect(workItemScope.final_deliverables).toHaveLength(2);
  });

  it('normalizes deprecated artifact preview targets on stored deliverables', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-target-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'workflow-intake-33 completion packet',
          state: 'final',
          summary_brief: 'Artifact-backed completion packet.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            url: '/artifacts/tasks/task-33/artifact-33?return_to=%2Fworkflows%2Fworkflow-1&return_source=deliverables',
            path: 'artifact:workflow/output/workflow-intake-33.md',
            artifact_id: 'artifact-33',
          },
          secondary_targets: [
            {
              target_kind: 'artifact',
              label: 'Artifact',
              url: 'http://dashboard.local/artifacts/tasks/task-34/artifact-34?return_to=%2Fworkflows%2Fworkflow-1',
              path: 'artifact:workflow/output/workflow-intake-34.md',
              artifact_id: 'artifact-34',
            },
          ],
          content_preview: {},
          source_brief_id: null,
          created_at: '2026-03-28T21:10:00.000Z',
          updated_at: '2026-03-28T21:10:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
    });

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-target-1',
        primary_target: expect.objectContaining({
          url: '/api/v1/tasks/task-33/artifacts/artifact-33/preview',
        }),
        secondary_targets: [
          expect.objectContaining({
            url: '/api/v1/tasks/task-34/artifacts/artifact-34/preview',
          }),
        ],
      }),
    ]);
  });

  it('does not crash when stored deliverables contain malformed target shapes', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-target-2',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Workflow completion packet',
          state: 'final',
          summary_brief: 'Stored target shapes were malformed.',
          preview_capabilities: {},
          primary_target: 'not-an-object',
          secondary_targets: {
            target_kind: 'artifact',
            label: 'Artifact',
            url: '/artifacts/tasks/task-35/artifact-35',
          },
          content_preview: {},
          source_brief_id: null,
          created_at: '2026-03-28T21:20:00.000Z',
          updated_at: '2026-03-28T21:20:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1');

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-target-2',
        primary_target: {},
        secondary_targets: [
          expect.objectContaining({
            url: '/api/v1/tasks/task-35/artifacts/artifact-35/preview',
          }),
        ],
      }),
    ]);
  });

  it('drops empty malformed secondary target entries while preserving real targets', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-target-3',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Workflow completion packet',
          state: 'final',
          summary_brief: 'Stored mixed target shapes were malformed.',
          preview_capabilities: {},
          primary_target: ['not-an-object'],
          secondary_targets: [
            'not-an-object',
            null,
            {
              target_kind: 'artifact',
              label: 'Artifact',
              url: '/artifacts/tasks/task-36/artifact-36',
            },
          ],
          content_preview: {},
          source_brief_id: null,
          created_at: '2026-03-28T21:21:00.000Z',
          updated_at: '2026-03-28T21:21:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1');

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-target-3',
        primary_target: {},
        secondary_targets: [
          expect.objectContaining({
            url: '/api/v1/tasks/task-36/artifacts/artifact-36/preview',
          }),
        ],
      }),
    ]);
  });

});

