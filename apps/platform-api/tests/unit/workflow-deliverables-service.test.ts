import { describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverablesService } from '../../src/services/workflow-operations/workflow-deliverables-service.js';

describe('WorkflowDeliverablesService', () => {
  it('keeps workflow-scope deliverables limited to workflow-scoped provenance packets', async () => {
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
          work_item_id: 'work-item-1',
          descriptor_kind: 'repo',
          delivery_stage: 'in_progress',
          title: 'Rollback Checklist',
          state: 'draft',
          summary_brief: 'Waiting on approval.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: {},
          source_brief_id: 'brief-1',
          created_at: '2026-03-27T22:34:00.000Z',
          updated_at: '2026-03-27T22:34:00.000Z',
        },
      ]),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: null,
          request_id: 'request-1',
          execution_context_id: 'execution-1',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'specialist',
          source_role_name: 'Verifier',
          status_kind: 'handoff',
          short_brief: { headline: 'Verification handed the rollback checklist back for review.' },
          detailed_brief_json: {
            headline: 'Verification handed the rollback checklist back for review.',
            status_kind: 'handoff',
          },
          linked_target_ids: [],
          sequence_number: 4,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:33:00.000Z',
          updated_at: '2026-03-27T22:33:00.000Z',
        },
        {
          id: 'brief-2',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-2',
          request_id: 'request-2',
          execution_context_id: 'task-2',
          brief_kind: 'milestone',
          brief_scope: 'work_item_handoff',
          source_kind: 'specialist',
          source_role_name: 'Builder',
          status_kind: 'handoff',
          short_brief: { headline: 'Task evidence should stay out of workflow deliverables.' },
          detailed_brief_json: {
            headline: 'Task evidence should stay out of workflow deliverables.',
            status_kind: 'handoff',
          },
          linked_target_ids: [],
          sequence_number: 3,
          related_artifact_ids: ['artifact-1'],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:32:00.000Z',
          updated_at: '2026-03-27T22:32:00.000Z',
        },
      ]),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => [
        {
          id: 'packet-launch',
          workflow_id: 'workflow-1',
          work_item_id: null,
          packet_kind: 'launch',
          source: 'operator',
          summary: 'Initial launch packet',
          structured_inputs: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:30:00.000Z',
          updated_at: '2026-03-27T22:30:00.000Z',
          files: [],
        },
        {
          id: 'packet-redrive',
          workflow_id: 'workflow-1',
          work_item_id: null,
          packet_kind: 'redrive_patch',
          source: 'redrive',
          summary: 'Retry with corrected inputs',
          structured_inputs: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:31:00.000Z',
          updated_at: '2026-03-27T22:31:00.000Z',
          files: [],
        },
        {
          id: 'packet-intake',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          packet_kind: 'intake',
          source: 'operator',
          summary: 'Added rollback notes',
          structured_inputs: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:32:00.000Z',
          updated_at: '2026-03-27T22:32:00.000Z',
          files: [],
        },
        {
          id: 'packet-intervention',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          packet_kind: 'intervention_attachment',
          source: 'operator',
          summary: 'Attached rollback notes',
          structured_inputs: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:32:30.000Z',
          updated_at: '2026-03-27T22:32:30.000Z',
          files: [{ id: 'file-1', file_name: 'rollback.txt' }],
        },
      ]),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
    );
    const result = await service.getDeliverables('tenant-1', 'workflow-1');

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'deliverable-1' }),
    ]);
    expect(result.in_progress_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'deliverable-2' }),
    ]);
    expect(result.working_handoffs).toEqual([
      expect.objectContaining({ id: 'brief-1' }),
    ]);
    expect(result.inputs_and_provenance).toEqual({
      launch_packet: expect.objectContaining({ id: 'packet-launch' }),
      supplemental_packets: [],
      intervention_attachments: [],
      redrive_packet: expect.objectContaining({ id: 'packet-redrive' }),
    });
  });

  it('keeps selected work-item deliverables limited to the selected work-item packet set', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => []),
    };
    const briefService = {
      listBriefs: vi.fn(async () => []),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => [
        {
          id: 'packet-launch',
          workflow_id: 'workflow-1',
          work_item_id: null,
          packet_kind: 'launch',
          source: 'operator',
          summary: 'Initial launch packet',
          structured_inputs: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:30:00.000Z',
          updated_at: '2026-03-27T22:30:00.000Z',
          files: [],
        },
        {
          id: 'packet-redrive',
          workflow_id: 'workflow-1',
          work_item_id: null,
          packet_kind: 'redrive_patch',
          source: 'redrive',
          summary: 'Retry with corrected inputs',
          structured_inputs: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:31:00.000Z',
          updated_at: '2026-03-27T22:31:00.000Z',
          files: [],
        },
        {
          id: 'packet-intake',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          packet_kind: 'intake',
          source: 'operator',
          summary: 'Added rollback notes',
          structured_inputs: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:32:00.000Z',
          updated_at: '2026-03-27T22:32:00.000Z',
          files: [],
        },
        {
          id: 'packet-intervention',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          packet_kind: 'intervention_attachment',
          source: 'operator',
          summary: 'Attached rollback notes',
          structured_inputs: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:32:30.000Z',
          updated_at: '2026-03-27T22:32:30.000Z',
          files: [{ id: 'file-1', file_name: 'rollback.txt' }],
        },
      ]),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
    });

    expect(result.inputs_and_provenance).toEqual({
      launch_packet: null,
      supplemental_packets: [expect.objectContaining({ id: 'packet-intake' })],
      intervention_attachments: [expect.objectContaining({ id: 'packet-intervention' })],
      redrive_packet: null,
    });
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

    const result = await service.getDeliverables('tenant-1', 'workflow-1');

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'deliverable-1' }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
  });

  it('synthesizes a final handoff packet deliverable for completed work items without materialized descriptors', async () => {
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

    const result = await service.getDeliverables('tenant-1', 'workflow-1');

    expect(result.final_deliverables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor_id: 'handoff:handoff-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'handoff_packet',
          delivery_stage: 'final',
          state: 'final',
          primary_target: expect.objectContaining({
            target_kind: 'inline_summary',
            label: 'Review completion packet',
          }),
        }),
      ]),
    );
    expect(result.final_deliverables).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ descriptor_id: 'handoff:handoff-2' })]),
    );
  });

  it('keeps synthesized handoff packets scoped to the selected work item', async () => {
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
    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'handoff:handoff-1',
        work_item_id: 'work-item-1',
      }),
    ]);
  });

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
});
