import { describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverablesService } from '../../../../src/services/workflow-operations/workflow-deliverables-service.js';

describe('WorkflowDeliverablesService', () => {
  it('synthesizes workflow deliverables from workflow documents when descriptors are absent', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => []),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };
    const documentService = {
      listWorkflowDocuments: vi.fn(async () => [
        {
          logical_name: 'terminal-brief',
          scope: 'workflow',
          source: 'external',
          title: 'Terminal brief',
          description: 'Seeded final deliverable for workflow observations.',
          metadata: {},
          url: 'https://example.com/terminal-brief',
          created_at: '2026-03-29T20:10:00.000Z',
        },
      ]),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
      undefined,
      undefined,
      documentService as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1');

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'workflow-document:terminal-brief',
        work_item_id: null,
        title: 'Terminal brief',
        summary_brief: 'Seeded final deliverable for workflow observations.',
      }),
    ]);
    const firstDeliverable = result.final_deliverables[0] as
      | { primary_target?: Record<string, unknown> }
      | undefined;

    expect(firstDeliverable?.primary_target).toEqual(
      expect.objectContaining({
        target_kind: 'external',
        url: 'https://example.com/terminal-brief',
      }),
    );
  });

  it('paginates deliverables and exposes the next cursor', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'artifact',
          delivery_stage: 'final',
          title: 'Release Notes',
          state: 'final',
          summary_brief: 'Final release notes approved.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: {},
          source_brief_id: 'brief-2',
          created_at: '2026-03-27T22:35:00.000Z',
          updated_at: '2026-03-27T22:35:00.000Z',
        },
        {
          descriptor_id: 'deliverable-2',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'artifact',
          delivery_stage: 'final',
          title: 'Validation Notes',
          state: 'final',
          summary_brief: 'Validation notes approved.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: {},
          source_brief_id: 'brief-3',
          created_at: '2026-03-27T22:34:00.000Z',
          updated_at: '2026-03-27T22:34:00.000Z',
        },
      ]),
    };
    const briefService = { listBriefs: vi.fn(async () => []) };
    const inputPacketService = { listWorkflowInputPackets: vi.fn(async () => []) };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1', {
      limit: 1,
    });

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'deliverable-1' }),
    ]);
    expect(result.all_deliverables).toHaveLength(2);
    expect(result.next_cursor).toBe('2026-03-27T22:35:00.000Z|deliverable-1');
  });

  it('treats deliverables linked from completed outcome briefs as final even before the descriptor row is updated', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'artifact',
          delivery_stage: 'in_progress',
          title: 'Triage summary',
          state: 'draft',
          summary_brief: 'Final triage summary ready for review.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: {},
          source_brief_id: 'brief-1',
          created_at: '2026-03-27T22:35:00.000Z',
          updated_at: '2026-03-27T22:35:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          request_id: 'request-1',
          execution_context_id: 'task-1',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'specialist',
          source_role_name: 'Builder',
          status_kind: 'completed',
          short_brief: { headline: 'Triage summary completed.' },
          detailed_brief_json: {
            headline: 'Triage summary completed.',
            status_kind: 'completed',
          },
          linked_target_ids: [],
          sequence_number: 5,
          related_artifact_ids: [],
          related_output_descriptor_ids: ['deliverable-1'],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:36:00.000Z',
          updated_at: '2026-03-27T22:36:00.000Z',
        },
      ]),
    };
    const inputPacketService = { listWorkflowInputPackets: vi.fn(async () => []) };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
    });

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'deliverable-1' }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
  });

  it('keeps rolled-up work-item deliverables visible in workflow scope when a completed brief finalized the descriptor before the row updated', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-workflow-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'artifact',
          delivery_stage: 'final',
          title: 'Workflow status packet',
          state: 'final',
          summary_brief: 'Workflow status is available.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: {},
          source_brief_id: null,
          created_at: '2026-03-27T22:34:00.000Z',
          updated_at: '2026-03-27T22:34:00.000Z',
        },
        {
          descriptor_id: 'deliverable-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'artifact',
          delivery_stage: 'in_progress',
          title: 'Triage summary',
          state: 'draft',
          summary_brief: 'Final triage summary ready for review.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: {},
          source_brief_id: 'brief-1',
          created_at: '2026-03-27T22:35:00.000Z',
          updated_at: '2026-03-27T22:35:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          request_id: 'request-1',
          execution_context_id: 'task-1',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'specialist',
          source_role_name: 'Builder',
          status_kind: 'completed',
          short_brief: { headline: 'Triage summary completed.' },
          detailed_brief_json: {
            headline: 'Triage summary completed.',
            status_kind: 'completed',
          },
          linked_target_ids: [],
          sequence_number: 5,
          related_artifact_ids: [],
          related_output_descriptor_ids: ['deliverable-1'],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:36:00.000Z',
          updated_at: '2026-03-27T22:36:00.000Z',
        },
      ]),
    };
    const inputPacketService = { listWorkflowInputPackets: vi.fn(async () => []) };
    const workItemSource = {
      listIncompleteWorkItemIds: vi.fn(async () => []),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
      undefined,
      workItemSource as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1');

    expect(result.final_deliverables).toHaveLength(2);
    expect(result.final_deliverables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor_id: 'deliverable-workflow-1',
          work_item_id: null,
        }),
        expect.objectContaining({
          descriptor_id: 'deliverable-1',
          work_item_id: 'work-item-1',
        }),
      ]),
    );
    expect(result.in_progress_deliverables).toEqual([]);
  });

  it('keeps completed work-item handoffs in working_handoffs without synthesizing deliverables', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-2',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-2',
          descriptor_kind: 'artifact',
          delivery_stage: 'final',
          title: 'Workflow Intake 02 packet',
          state: 'final',
          summary_brief: 'Materialized descriptor already exists.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: {},
          source_brief_id: null,
          created_at: '2026-03-27T22:35:00.000Z',
          updated_at: '2026-03-27T22:35:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const inputPacketService = { listWorkflowInputPackets: vi.fn(async () => []) };
    const handoffSource = {
      listLatestCompletedWorkItemHandoffs: vi.fn(async () => [
        {
          id: 'handoff-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          role: 'policy-assessor',
          summary: 'workflow-intake-01 is approved and ready to remain open.',
          completion:
            'Approved the intake packet and confirmed it satisfies the readiness criteria without additional findings.',
          completion_state: 'completed',
          resolution: 'approved',
          decision_state: 'approved',
          created_at: '2026-03-27T22:36:00.000Z',
          work_item_title: 'workflow-intake-01',
        },
        {
          id: 'handoff-2',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-2',
          task_id: 'task-2',
          role: 'policy-assessor',
          summary: 'workflow-intake-02 is approved and ready to remain open.',
          completion: 'This record should be ignored because a real descriptor already exists.',
          completion_state: 'completed',
          resolution: 'approved',
          decision_state: 'approved',
          created_at: '2026-03-27T22:37:00.000Z',
          work_item_title: 'workflow-intake-02',
        },
      ]),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
      handoffSource as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
    });

    expect(result.final_deliverables).toEqual([]);
    expect(result.in_progress_deliverables).toEqual([]);
    expect(result.working_handoffs).toEqual([]);
  });

  it('requests handoffs for the selected work item without materializing a deliverable row', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => []),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const inputPacketService = { listWorkflowInputPackets: vi.fn(async () => []) };
    const handoffSource = {
      listLatestCompletedWorkItemHandoffs: vi.fn(async () => [
        {
          id: 'handoff-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          role: 'policy-assessor',
          summary: 'workflow-intake-01 is approved and ready to remain open.',
          completion: 'Approved work item 01.',
          completion_state: 'completed',
          resolution: 'approved',
          decision_state: 'approved',
          created_at: '2026-03-27T22:36:00.000Z',
          work_item_title: 'workflow-intake-01',
        },
      ]),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
      handoffSource as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
    });

    expect(handoffSource.listLatestCompletedWorkItemHandoffs).toHaveBeenCalledWith(
      'tenant-1',
      'workflow-1',
      { workItemId: 'work-item-1' },
    );
    expect(result.final_deliverables).toEqual([]);
    expect(result.in_progress_deliverables).toEqual([]);
    expect(result.all_deliverables).toEqual([]);
  });

});
