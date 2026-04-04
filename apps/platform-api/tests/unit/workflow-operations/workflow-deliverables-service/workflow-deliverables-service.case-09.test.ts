import { describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverablesService } from '../../../../src/services/workflow-operations/workflow-deliverables-service.js';

describe('WorkflowDeliverablesService', () => {
  it('prefers the actual content descriptor and inherits final lifecycle from duplicate finalized packets', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'question-framing-content',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-question-framing',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'in_progress',
          title: 'Question framing deliverable',
          state: 'draft',
          summary_brief: 'Framed the research question and decision context.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'artifact',
            label: 'Question framing deliverable',
            url: '/api/v1/tasks/task-question-framing/artifacts/artifact-question-framing/preview',
            path: 'artifact:workflow-1/deliverables/question-framing-brief.md',
            artifact_id: 'artifact-question-framing',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Framed the research question and decision context.',
          },
          source_brief_id: 'brief-question-framing',
          created_at: '2026-04-03T22:20:00.000Z',
          updated_at: '2026-04-03T22:20:00.000Z',
        },
        {
          descriptor_id: 'question-framing-completion',
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
            path: 'artifact:workflow-1/deliverables/question-framing-brief.md',
            artifact_id: 'artifact-question-framing',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Completed and verified the question framing deliverable.',
          },
          source_brief_id: null,
          created_at: '2026-04-03T22:21:00.000Z',
          updated_at: '2026-04-03T22:21:00.000Z',
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
            path: 'artifact:workflow-1/deliverables/question-framing-brief.md',
            artifact_id: 'artifact-question-framing',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Completed and verified the question framing deliverable.',
            rollup_source_descriptor_id: 'question-framing-completion',
            rollup_source_work_item_id: 'work-item-question-framing',
          },
          source_brief_id: null,
          created_at: '2026-04-03T22:22:00.000Z',
          updated_at: '2026-04-03T22:22:00.000Z',
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
        title: 'Question framing deliverable',
        delivery_stage: 'final',
        state: 'final',
      }),
    ]);
    expect(workflowScope.in_progress_deliverables).toEqual([]);

    const workItemScope = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-question-framing',
    });
    expect(workItemScope.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'question-framing-content',
        work_item_id: 'work-item-question-framing',
        title: 'Question framing deliverable',
        delivery_stage: 'final',
        state: 'final',
      }),
    ]);
    expect(workItemScope.in_progress_deliverables).toEqual([]);
    expect(workItemScope.all_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'question-framing-content',
        work_item_id: 'work-item-question-framing',
        title: 'Question framing deliverable',
        delivery_stage: 'final',
        state: 'final',
      }),
    ]);
  });
});
