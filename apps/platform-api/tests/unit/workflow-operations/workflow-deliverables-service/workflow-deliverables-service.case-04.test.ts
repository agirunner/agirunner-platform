import { describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverablesService } from '../../../../src/services/workflow-operations/workflow-deliverables-service.js';

describe('WorkflowDeliverablesService', () => {
  it('synthesizes a final brief-backed deliverable when a finalized deliverable brief has no descriptor row', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => []),
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
          source_role_name: 'Policy Assessor',
          status_kind: 'approved',
          short_brief: { headline: 'workflow-intake-01 is approved and ready to remain open.' },
          detailed_brief_json: {
            headline: 'workflow-intake-01 is approved and ready to remain open.',
            summary: 'The only structured completion record is the finalized brief itself.',
            status_kind: 'approved',
          },
          linked_target_ids: [],
          sequence_number: 6,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:40:00.000Z',
          updated_at: '2026-03-27T22:40:00.000Z',
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
      expect.objectContaining({
        descriptor_id: 'brief:brief-1',
        descriptor_kind: 'brief_packet',
        work_item_id: 'work-item-1',
        delivery_stage: 'final',
        state: 'final',
        primary_target: expect.objectContaining({
          target_kind: 'inline_summary',
        }),
      }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
    expect(result.working_handoffs).toEqual([
      expect.objectContaining({ id: 'brief-1' }),
    ]);
  });

  it('keeps a finalized brief-backed deliverable when the same work item already has an in-progress packet', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'handoff-packet-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'handoff_packet',
          delivery_stage: 'in_progress',
          title: 'workflow-intake-01 handoff packet',
          state: 'draft',
          summary_brief: 'Intermediate delivery packet.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'inline_summary',
            label: 'Review handoff packet',
          },
          secondary_targets: [],
          content_preview: {},
          source_brief_id: null,
          created_at: '2026-03-27T22:39:00.000Z',
          updated_at: '2026-03-27T22:39:00.000Z',
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
          source_role_name: 'Policy Assessor',
          status_kind: 'approved',
          short_brief: { headline: 'workflow-intake-01 is approved and ready to remain open.' },
          detailed_brief_json: {
            headline: 'workflow-intake-01 is approved and ready to remain open.',
            summary: 'The finalized brief should still materialize a final packet for this work item.',
            status_kind: 'approved',
          },
          linked_target_ids: [],
          sequence_number: 6,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:40:00.000Z',
          updated_at: '2026-03-27T22:40:00.000Z',
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
      expect.objectContaining({
        descriptor_id: 'brief:brief-1',
        work_item_id: 'work-item-1',
        delivery_stage: 'final',
      }),
    ]);
    expect(result.in_progress_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'handoff-packet-1',
        work_item_id: 'work-item-1',
        delivery_stage: 'in_progress',
      }),
    ]);
  });

  it('keeps a synthesized final handoff packet when the same work item already has an in-progress deliverable', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'handoff-packet-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'handoff_packet',
          delivery_stage: 'in_progress',
          title: 'workflow-intake-01 handoff packet',
          state: 'draft',
          summary_brief: 'Intermediate delivery packet.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'inline_summary',
            label: 'Review handoff packet',
          },
          secondary_targets: [],
          content_preview: {},
          source_brief_id: null,
          created_at: '2026-03-27T22:39:00.000Z',
          updated_at: '2026-03-27T22:39:00.000Z',
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
          work_item_title: 'workflow-intake-01',
          summary: 'workflow-intake-01 is approved and ready to remain open.',
          completion: 'full',
          resolution: 'approved',
          decision_state: 'approved',
          role: 'policy-assessor',
          created_at: '2026-03-27T22:40:00.000Z',
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

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'handoff:handoff-1',
        work_item_id: 'work-item-1',
        delivery_stage: 'final',
      }),
    ]);
    expect(result.in_progress_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'handoff-packet-1',
        work_item_id: 'work-item-1',
        delivery_stage: 'in_progress',
      }),
    ]);
  });

  it('does not synthesize an orchestrator brief packet when the same work item already has a specialist handoff packet', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'handoff-packet-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'handoff_packet',
          delivery_stage: 'in_progress',
          title: 'workflow-intake-01 handoff packet',
          state: 'draft',
          summary_brief: 'Policy assessor approved the intake packet.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'inline_summary',
            label: 'Review handoff packet',
          },
          secondary_targets: [],
          content_preview: {
            summary: 'Policy assessor approved the intake packet.\n\nProduced by: Policy Assessor',
          },
          source_brief_id: null,
          created_at: '2026-03-28T20:40:00.000Z',
          updated_at: '2026-03-28T20:40:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-orchestrator-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: null,
          request_id: 'request-orchestrator-1',
          execution_context_id: 'activation-1',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'completed',
          short_brief: { headline: 'workflow-intake-01 completion packet' },
          detailed_brief_json: {
            headline: 'workflow-intake-01 completion packet',
            summary: 'The orchestrator reviewed the item and found no further routing was required.',
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
          created_at: '2026-03-28T20:41:00.000Z',
          updated_at: '2026-03-28T20:41:00.000Z',
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
      workItemId: 'work-item-1',
    });

    expect(result.final_deliverables).toEqual([]);
    expect(result.in_progress_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'handoff-packet-1',
        work_item_id: 'work-item-1',
      }),
    ]);
    expect(result.working_handoffs).toEqual([
      expect.objectContaining({
        id: 'brief-orchestrator-1',
        source_role_name: 'Orchestrator',
      }),
    ]);
  });

  it('prefers the specialist handoff packet over an orchestrator brief for completed work-item deliverables', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => []),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-orchestrator-2',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: null,
          request_id: 'request-orchestrator-2',
          execution_context_id: 'activation-2',
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
          sequence_number: 2,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-28T20:42:00.000Z',
          updated_at: '2026-03-28T20:42:00.000Z',
        },
      ]),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };
    const handoffSource = {
      listLatestCompletedWorkItemHandoffs: vi.fn(async () => [
        {
          id: 'handoff-specialist-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          role: 'policy-assessor',
          summary: 'workflow-intake-01 is approved and ready to remain open.',
          completion: 'Approved the intake packet and closed the work item.',
          completion_state: 'full',
          resolution: 'approved',
          decision_state: 'approved',
          created_at: '2026-03-28T20:41:00.000Z',
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

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'handoff:handoff-specialist-1',
        work_item_id: 'work-item-1',
        content_preview: expect.objectContaining({
          summary: expect.stringContaining('Produced by: Policy Assessor'),
        }),
      }),
    ]);
    expect(result.final_deliverables).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ descriptor_id: 'brief:brief-orchestrator-2' })]),
    );
  });

  it('does not synthesize a work-item completion packet from an orchestrator handoff', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => []),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };
    const handoffSource = {
      listLatestCompletedWorkItemHandoffs: vi.fn(async () => [
        {
          id: 'handoff-orchestrator-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-orchestrator-1',
          role: 'orchestrator',
          summary: 'The orchestrator reviewed the completed work item.',
          completion: 'No further routing was required.',
          completion_state: 'full',
          resolution: 'approved',
          decision_state: 'approved',
          created_at: '2026-03-28T20:41:00.000Z',
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

    expect(result.final_deliverables).toEqual([]);
    expect(result.in_progress_deliverables).toEqual([]);
  });

});

