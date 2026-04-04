import { describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverablesService } from '../../../../src/services/workflow-operations/workflow-deliverables-service.js';

describe('WorkflowDeliverablesService', () => {
  it('suppresses an orchestrator brief packet when the same work item already has a canonical final packet', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-work-item-2',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-2',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'workflow-intake-02 completion packet',
          state: 'final',
          summary_brief: 'Approved by policy assessor.',
          preview_capabilities: {},
          primary_target: { target_kind: 'inline_summary', label: 'Review completion packet' },
          secondary_targets: [],
          content_preview: {
            summary: 'Approved by policy assessor.\n\nProduced by: Policy Assessor',
          },
          source_brief_id: null,
          created_at: '2026-03-28T21:05:00.000Z',
          updated_at: '2026-03-28T21:05:00.000Z',
        },
        {
          descriptor_id: 'brief-packet-work-item-2',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-2',
          descriptor_kind: 'brief_packet',
          delivery_stage: 'final',
          title: 'workflow-intake-02 completion packet',
          state: 'final',
          summary_brief: 'The orchestrator observed closure after the specialist completed the packet.',
          preview_capabilities: {},
          primary_target: { target_kind: 'inline_summary', label: 'Review completion packet' },
          secondary_targets: [],
          content_preview: {
            summary: 'The orchestrator observed closure after the specialist completed the packet.\n\nProduced by: Orchestrator',
          },
          source_brief_id: 'brief-orchestrator-20',
          created_at: '2026-03-28T21:06:00.000Z',
          updated_at: '2026-03-28T21:06:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-orchestrator-20',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-2',
          task_id: null,
          request_id: 'request-orchestrator-20',
          execution_context_id: 'activation-20',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'completed',
          short_brief: { headline: 'workflow-intake-02 completion packet' },
          detailed_brief_json: {
            headline: 'workflow-intake-02 completion packet',
            summary: 'The orchestrator observed closure after the specialist completed the packet.',
            status_kind: 'completed',
          },
          linked_target_ids: ['work-item-2'],
          sequence_number: 20,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-28T21:06:00.000Z',
          updated_at: '2026-03-28T21:06:00.000Z',
        },
      ]),
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
      workItemId: 'work-item-2',
    });

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-work-item-2',
        work_item_id: 'work-item-2',
        content_preview: expect.objectContaining({
          summary: expect.stringContaining('Produced by: Policy Assessor'),
        }),
      }),
    ]);
    expect(result.final_deliverables).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ descriptor_id: 'brief-packet-work-item-2' })]),
    );
  });

  it('keeps a workflow-scoped orchestrator completion brief in working handoffs without synthesizing a deliverable', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => []),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-orchestrator-linked-2',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-orchestrator-linked-2',
          execution_context_id: 'activation-4',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'completed',
          short_brief: { headline: 'workflow-intake-02 completion packet' },
          detailed_brief_json: {
            headline: 'workflow-intake-02 completion packet',
            summary: 'The orchestrator observed closure after the specialist completed the packet.',
            status_kind: 'completed',
          },
          linked_target_ids: ['workflow-1', 'work-item-2'],
          sequence_number: 4,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-28T20:44:00.000Z',
          updated_at: '2026-03-28T20:44:00.000Z',
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

    const result = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-2',
    });

    expect(result.final_deliverables).toEqual([]);
    expect(result.in_progress_deliverables).toEqual([]);
    expect(result.working_handoffs).toEqual([
      expect.objectContaining({
        id: 'brief-orchestrator-linked-2',
      }),
    ]);
  });

  it('keeps a work-item completion brief in working handoffs without synthesizing a deliverable', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => []),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-orchestrator-work-item-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: null,
          request_id: 'request-orchestrator-work-item-1',
          execution_context_id: 'activation-1',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'completed',
          short_brief: { headline: 'workflow-intake-01 completion packet' },
          detailed_brief_json: {
            headline: 'workflow-intake-01 completion packet',
            summary: 'The orchestrator observed closure after the specialist completed the packet.',
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
          created_at: '2026-03-28T21:06:00.000Z',
          updated_at: '2026-03-28T21:06:00.000Z',
        },
      ]),
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

    expect(result.final_deliverables).toEqual([]);
    expect(result.working_handoffs).toEqual([
      expect.objectContaining({
        id: 'brief-orchestrator-work-item-1',
      }),
    ]);
  });

  it('hides a superseded final packet from current deliverables when the work item is active again', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-revision-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'workflow-intake-01 completion packet',
          state: 'superseded',
          summary_brief: 'Revision 1 packet',
          preview_capabilities: {},
          primary_target: { target_kind: 'inline_summary', label: 'Review completion packet' },
          secondary_targets: [],
          content_preview: {
            summary: 'Revision 1 packet',
          },
          source_brief_id: null,
          created_at: '2026-03-28T21:00:00.000Z',
          updated_at: '2026-03-28T21:00:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
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
  });

  it('reclassifies a stored final work-item packet into in-progress deliverables when the selected work item is still incomplete', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-current',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'workflow-intake-01 completion packet',
          state: 'final',
          summary_brief: 'Current completion packet.',
          preview_capabilities: {},
          primary_target: { target_kind: 'inline_summary', label: 'Review completion packet' },
          secondary_targets: [],
          content_preview: {
            summary: 'Current completion packet.',
          },
          source_brief_id: null,
          created_at: '2026-03-28T21:00:00.000Z',
          updated_at: '2026-03-28T21:00:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
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
    expect(result.in_progress_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-current',
        work_item_id: 'work-item-1',
        delivery_stage: 'in_progress',
        state: 'approved',
      }),
    ]);
    expect(result.all_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-current',
        work_item_id: 'work-item-1',
        delivery_stage: 'in_progress',
        state: 'approved',
      }),
    ]);
  });

  it('keeps an incomplete work-item packet visible in workflow scope by reclassifying it into in-progress deliverables', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-current',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'workflow-intake-01 completion packet',
          state: 'final',
          summary_brief: 'Current completion packet.',
          preview_capabilities: {},
          primary_target: { target_kind: 'inline_summary', label: 'Review completion packet' },
          secondary_targets: [],
          content_preview: {
            summary: 'Current completion packet.',
          },
          source_brief_id: null,
          created_at: '2026-03-28T21:00:00.000Z',
          updated_at: '2026-03-28T21:00:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
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

    const result = await service.getDeliverables('tenant-1', 'workflow-1');

    expect(result.final_deliverables).toEqual([]);
    expect(result.in_progress_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-current',
        work_item_id: 'work-item-1',
        delivery_stage: 'in_progress',
        state: 'approved',
      }),
    ]);
    expect(result.all_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-current',
        delivery_stage: 'in_progress',
        state: 'approved',
      }),
    ]);
  });

});
