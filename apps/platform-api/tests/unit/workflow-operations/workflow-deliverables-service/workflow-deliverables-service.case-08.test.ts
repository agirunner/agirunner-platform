import { describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverablesService } from '../../../../src/services/workflow-operations/workflow-deliverables-service.js';

describe('WorkflowDeliverablesService', () => {
  it('keeps a finalized brief in working_handoffs without surfacing a deliverable for a reopened active work item', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => []),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-revision-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: null,
          request_id: 'request-brief-revision-1',
          execution_context_id: 'activation-brief-revision-1',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'specialist',
          source_role_name: 'Developer',
          status_kind: 'completed',
          short_brief: { headline: 'workflow-intake-01 completion packet' },
          detailed_brief_json: {
            headline: 'workflow-intake-01 completion packet',
            summary: 'Revision 1 completion packet.',
            status_kind: 'completed',
          },
          linked_target_ids: ['work-item-1'],
          sequence_number: 1,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-28T21:05:00.000Z',
          updated_at: '2026-03-28T21:05:00.000Z',
        },
      ]),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };
    const activeWorkItemSource = {
      listIncompleteWorkItemIds: vi.fn(async () => ['work-item-1']),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
      undefined,
      activeWorkItemSource as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
    });

    expect(result.final_deliverables).toEqual([]);
    expect(result.in_progress_deliverables).toEqual([]);
    expect(result.all_deliverables).toEqual([]);
    expect(result.working_handoffs).toEqual([
      expect.objectContaining({
        id: 'brief-revision-1',
      }),
    ]);
  });

  it('excludes workflow-scoped deliverables that are not attributed to the selected work item', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-architecture-rollup',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Architecture direction',
          state: 'final',
          summary_brief: 'Architecture direction was finalized.',
          preview_capabilities: {},
          primary_target: { target_kind: 'inline_summary', label: 'Review architecture direction' },
          secondary_targets: [],
          content_preview: {
            summary: 'Architecture direction was finalized.',
          },
          source_brief_id: 'brief-architecture-rollup',
          created_at: '2026-03-29T15:00:00.000Z',
          updated_at: '2026-03-29T15:00:00.000Z',
        },
        {
          descriptor_id: 'deliverable-implementation-packet',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-implementation',
          descriptor_kind: 'handoff_packet',
          delivery_stage: 'final',
          title: 'Implementation completion packet',
          state: 'final',
          summary_brief: 'Implementation work item completed.',
          preview_capabilities: {},
          primary_target: { target_kind: 'inline_summary', label: 'Review completion packet' },
          secondary_targets: [],
          content_preview: {
            summary: 'Implementation work item completed.',
          },
          source_brief_id: null,
          created_at: '2026-03-29T15:05:00.000Z',
          updated_at: '2026-03-29T15:05:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-architecture-rollup',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-architecture',
          task_id: null,
          request_id: 'request-architecture-rollup',
          execution_context_id: 'activation-architecture-rollup',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'specialist',
          source_role_name: 'Architect',
          status_kind: 'completed',
          short_brief: { headline: 'Architecture direction' },
          detailed_brief_json: {
            headline: 'Architecture direction',
            summary: 'Architecture direction was finalized.',
            status_kind: 'completed',
          },
          linked_target_ids: ['work-item-architecture'],
          sequence_number: 9,
          related_artifact_ids: [],
          related_output_descriptor_ids: ['deliverable-architecture-rollup'],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-29T15:00:00.000Z',
          updated_at: '2026-03-29T15:00:00.000Z',
        },
      ]),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };
    const workItemSource = {
      listIncompleteWorkItemIds: vi.fn(async () => []),
      listExistingWorkItemIds: vi.fn(async () => ['work-item-architecture', 'work-item-implementation']),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
      undefined,
      workItemSource as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-implementation',
    });

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-implementation-packet',
        work_item_id: 'work-item-implementation',
      }),
    ]);
    expect(result.final_deliverables).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ descriptor_id: 'deliverable-architecture-rollup' }),
      ]),
    );
  });

  it('keeps plain workflow-scoped rollup deliverables visible beside the selected work-item deliverable', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'workflow-rollup',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Workflow rollup',
          state: 'final',
          summary_brief: 'Workflow-level deliverable packet.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: { summary: 'Workflow-level deliverable packet.' },
          source_brief_id: null,
          created_at: '2026-03-29T18:00:00.000Z',
          updated_at: '2026-03-29T18:00:00.000Z',
        },
        {
          descriptor_id: 'work-item-output',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Work-item deliverable',
          state: 'final',
          summary_brief: 'Selected work-item deliverable packet.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: { summary: 'Selected work-item deliverable packet.' },
          source_brief_id: null,
          created_at: '2026-03-29T18:01:00.000Z',
          updated_at: '2026-03-29T18:01:00.000Z',
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

    const result = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      limit: 20,
    });

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'work-item-output', work_item_id: 'work-item-1' }),
      expect.objectContaining({ descriptor_id: 'workflow-rollup', work_item_id: null }),
    ]);
    expect(result.all_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'work-item-output', work_item_id: 'work-item-1' }),
      expect.objectContaining({ descriptor_id: 'workflow-rollup', work_item_id: null }),
    ]);
  });

  it('collapses duplicate packet records for the same logical content to a single deliverable per scope', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'question-framing-brief-a',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-question-framing',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'in_progress',
          title: 'Question framing deliverable',
          state: 'draft',
          summary_brief: null,
          preview_capabilities: {},
          primary_target: {
            target_kind: 'inline_summary',
            label: 'Question framing deliverable',
            path: 'deliverables/question-framing.md',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Path: deliverables/question-framing.md',
          },
          source_brief_id: 'brief-question-framing-a',
          created_at: '2026-04-03T22:20:00.000Z',
          updated_at: '2026-04-03T22:20:00.000Z',
        },
        {
          descriptor_id: 'question-framing-brief-b',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-question-framing',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'in_progress',
          title: 'Question framing deliverable',
          state: 'draft',
          summary_brief: null,
          preview_capabilities: {},
          primary_target: {
            target_kind: 'inline_summary',
            label: 'Question framing deliverable',
            path: 'deliverables/question-framing.md',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Path: deliverables/question-framing.md',
          },
          source_brief_id: 'brief-question-framing-b',
          created_at: '2026-04-03T22:21:00.000Z',
          updated_at: '2026-04-03T22:21:00.000Z',
        },
        {
          descriptor_id: 'question-framing-final',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-question-framing',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Frame the research question and decision context completion packet',
          state: 'final',
          summary_brief: 'Completed and verified the question framing deliverable.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            url: '/api/v1/tasks/task-question-framing/artifacts/artifact-question-framing/preview',
            path: 'artifact:workflow-1/deliverables/question-framing.md',
            artifact_id: 'artifact-question-framing',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Completed and verified the question framing deliverable.',
          },
          source_brief_id: null,
          created_at: '2026-04-03T22:22:00.000Z',
          updated_at: '2026-04-03T22:22:00.000Z',
        },
        {
          descriptor_id: 'question-framing-rollup',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Frame the research question and decision context completion packet',
          state: 'final',
          summary_brief: 'Completed and verified the question framing deliverable.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            url: '/api/v1/tasks/task-question-framing/artifacts/artifact-question-framing/preview',
            path: 'artifact:workflow-1/deliverables/question-framing.md',
            artifact_id: 'artifact-question-framing',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Completed and verified the question framing deliverable.',
            rollup_source_descriptor_id: 'question-framing-final',
            rollup_source_work_item_id: 'work-item-question-framing',
          },
          source_brief_id: null,
          created_at: '2026-04-03T22:22:30.000Z',
          updated_at: '2026-04-03T22:22:30.000Z',
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
    expect(workflowScope.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'question-framing-rollup',
        work_item_id: null,
      }),
    ]);
    expect(workflowScope.in_progress_deliverables).toEqual([]);

    const workItemScope = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-question-framing',
    });
    expect(workItemScope.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'question-framing-brief-b',
        work_item_id: 'work-item-question-framing',
        title: 'Question framing deliverable',
        delivery_stage: 'final',
        state: 'final',
      }),
    ]);
    expect(workItemScope.in_progress_deliverables).toEqual([]);
  });

  it('suppresses packet-only wrapper rows when substantive content exists for the same owner', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'research-framing-content',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-research-framing',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Research framing',
          state: 'final',
          summary_brief: 'Framed the research question and decision context.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            url: '/api/v1/tasks/task-research-framing/artifacts/artifact-research-framing/preview',
            path: 'artifact:workflow-1/deliverables/research-framing.md',
            artifact_id: 'artifact-research-framing',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Framed the research question and decision context.',
          },
          source_brief_id: null,
          created_at: '2026-04-03T23:10:00.000Z',
          updated_at: '2026-04-03T23:10:00.000Z',
        },
        {
          descriptor_id: 'research-framing-wrapper',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-research-framing',
          descriptor_kind: 'handoff_packet',
          delivery_stage: 'final',
          title: 'Frame the research question and decision context completion packet',
          state: 'final',
          summary_brief: 'Completed the research framing step.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'inline_summary',
            label: 'Review completion packet',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Completed the research framing step.',
          },
          source_brief_id: null,
          created_at: '2026-04-03T23:11:00.000Z',
          updated_at: '2026-04-03T23:11:00.000Z',
        },
        {
          descriptor_id: 'research-framing-rollup-content',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Research framing',
          state: 'final',
          summary_brief: 'Framed the research question and decision context.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            url: '/api/v1/tasks/task-research-framing/artifacts/artifact-research-framing/preview',
            path: 'artifact:workflow-1/deliverables/research-framing.md',
            artifact_id: 'artifact-research-framing',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Framed the research question and decision context.',
            rollup_source_descriptor_id: 'research-framing-content',
            rollup_source_work_item_id: 'work-item-research-framing',
          },
          source_brief_id: null,
          created_at: '2026-04-03T23:12:00.000Z',
          updated_at: '2026-04-03T23:12:00.000Z',
        },
        {
          descriptor_id: 'research-framing-rollup-wrapper',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Frame the research question and decision context completion packet',
          state: 'final',
          summary_brief: 'Completed the research framing step.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'inline_summary',
            label: 'Review completion packet',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Completed the research framing step.',
            rollup_source_descriptor_id: 'research-framing-wrapper',
            rollup_source_work_item_id: 'work-item-research-framing',
          },
          source_brief_id: null,
          created_at: '2026-04-03T23:13:00.000Z',
          updated_at: '2026-04-03T23:13:00.000Z',
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
    expect(workflowScope.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'research-framing-rollup-content',
        work_item_id: null,
      }),
    ]);

    const workItemScope = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-research-framing',
    });
    expect(workItemScope.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'research-framing-content',
        work_item_id: 'work-item-research-framing',
      }),
    ]);
  });
});
