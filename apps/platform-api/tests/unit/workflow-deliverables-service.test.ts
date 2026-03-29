import { describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverablesService } from '../../src/services/workflow-operations/workflow-deliverables-service.js';

describe('WorkflowDeliverablesService', () => {
  it('keeps workflow scope limited to workflow-level deliverables while preserving selected work-item finals elsewhere', async () => {
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
          source_brief_id: 'brief-1',
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
          source_brief_id: 'brief-2',
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
          work_item_id: null,
          task_id: null,
          request_id: 'request-0',
          execution_context_id: 'execution-0',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'completed',
          short_brief: { headline: 'Workflow packet is available for review.' },
          detailed_brief_json: {
            headline: 'Workflow packet is available for review.',
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
          created_at: '2026-03-27T22:34:30.000Z',
          updated_at: '2026-03-27T22:34:30.000Z',
        },
        {
          id: 'brief-2',
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
          id: 'brief-3',
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
      expect.objectContaining({ descriptor_id: 'deliverable-1', work_item_id: null }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
    expect(result.all_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'deliverable-1', work_item_id: null }),
    ]);
    expect(result.working_handoffs).toEqual([
      expect.objectContaining({ id: 'brief-1' }),
    ]);
    expect(result.working_handoffs).not.toEqual([
      expect.arrayContaining([expect.objectContaining({ id: 'brief-3' })]),
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

  it('keeps workflow deliverables visible alongside the selected work-item layer while leaving inputs scoped', async () => {
    const allDeliverables = [
      {
        descriptor_id: 'workflow-deliverable',
        workflow_id: 'workflow-1',
        work_item_id: null,
        descriptor_kind: 'artifact',
        delivery_stage: 'final',
        title: 'Workflow completion packet',
        state: 'final',
        summary_brief: 'Workflow-level output',
        preview_capabilities: {},
        primary_target: {},
        secondary_targets: [],
        content_preview: {},
        source_brief_id: 'brief-workflow',
        created_at: '2026-03-27T22:35:00.000Z',
        updated_at: '2026-03-27T22:35:00.000Z',
      },
      {
        descriptor_id: 'work-item-deliverable',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        descriptor_kind: 'artifact',
        delivery_stage: 'final',
        title: 'Work item completion packet',
        state: 'final',
        summary_brief: 'Work-item output',
        preview_capabilities: {},
        primary_target: {},
        secondary_targets: [],
        content_preview: {},
        source_brief_id: 'brief-work-item',
        created_at: '2026-03-27T22:34:00.000Z',
        updated_at: '2026-03-27T22:34:00.000Z',
      },
      {
        descriptor_id: 'other-work-item-deliverable',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-2',
        descriptor_kind: 'artifact',
        delivery_stage: 'final',
        title: 'Other work item packet',
        state: 'final',
        summary_brief: 'Other output',
        preview_capabilities: {},
        primary_target: {},
        secondary_targets: [],
        content_preview: {},
        source_brief_id: 'brief-other',
        created_at: '2026-03-27T22:33:00.000Z',
        updated_at: '2026-03-27T22:33:00.000Z',
      },
    ];
    const allBriefs = [
      {
        id: 'brief-workflow',
        workflow_id: 'workflow-1',
        work_item_id: null,
        task_id: null,
        request_id: 'request-workflow',
        execution_context_id: 'workflow-1',
        brief_kind: 'milestone',
        brief_scope: 'deliverable_context',
        source_kind: 'orchestrator',
        source_role_name: 'Orchestrator',
        status_kind: 'completed',
        short_brief: { headline: 'Workflow completion packet published.' },
        detailed_brief_json: {
          headline: 'Workflow completion packet published.',
          status_kind: 'completed',
        },
        linked_target_ids: ['workflow-1'],
        sequence_number: 3,
        related_artifact_ids: [],
        related_output_descriptor_ids: ['workflow-deliverable'],
        related_intervention_ids: [],
        canonical_workflow_brief_id: null,
        created_by_type: 'user',
        created_by_id: 'user-1',
        created_at: '2026-03-27T22:35:00.000Z',
        updated_at: '2026-03-27T22:35:00.000Z',
      },
      {
        id: 'brief-work-item',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: 'task-1',
        request_id: 'request-work-item',
        execution_context_id: 'task-1',
        brief_kind: 'milestone',
        brief_scope: 'deliverable_context',
        source_kind: 'specialist',
        source_role_name: 'Builder',
        status_kind: 'completed',
        short_brief: { headline: 'Work item completion packet published.' },
        detailed_brief_json: {
          headline: 'Work item completion packet published.',
          status_kind: 'completed',
        },
        linked_target_ids: ['workflow-1', 'work-item-1'],
        sequence_number: 2,
        related_artifact_ids: [],
        related_output_descriptor_ids: ['work-item-deliverable'],
        related_intervention_ids: [],
        canonical_workflow_brief_id: null,
        created_by_type: 'user',
        created_by_id: 'user-1',
        created_at: '2026-03-27T22:34:00.000Z',
        updated_at: '2026-03-27T22:34:00.000Z',
      },
      {
        id: 'brief-other',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-2',
        task_id: 'task-2',
        request_id: 'request-other',
        execution_context_id: 'task-2',
        brief_kind: 'milestone',
        brief_scope: 'deliverable_context',
        source_kind: 'specialist',
        source_role_name: 'Verifier',
        status_kind: 'completed',
        short_brief: { headline: 'Other work item packet published.' },
        detailed_brief_json: {
          headline: 'Other work item packet published.',
          status_kind: 'completed',
        },
        linked_target_ids: ['workflow-1', 'work-item-2'],
        sequence_number: 1,
        related_artifact_ids: [],
        related_output_descriptor_ids: ['other-work-item-deliverable'],
        related_intervention_ids: [],
        canonical_workflow_brief_id: null,
        created_by_type: 'user',
        created_by_id: 'user-1',
        created_at: '2026-03-27T22:33:00.000Z',
        updated_at: '2026-03-27T22:33:00.000Z',
      },
    ];
    const deliverableService = {
      listDeliverables: vi.fn(
        async (
          _tenantId: string,
          _workflowId: string,
          input?: { workItemId?: string; includeWorkflowScope?: boolean },
        ) =>
          allDeliverables.filter((deliverable) => {
            if (!input?.workItemId) {
              return true;
            }
            if (deliverable.work_item_id === input.workItemId) {
              return true;
            }
            return input.includeWorkflowScope === true && deliverable.work_item_id === null;
          }),
      ),
    };
    const briefService = {
      listBriefs: vi.fn(
        async (
          _tenantId: string,
          _workflowId: string,
          input?: { workItemId?: string; includeWorkflowScope?: boolean },
        ) =>
          allBriefs.filter((brief) => {
            if (!input?.workItemId) {
              return true;
            }
            if (brief.work_item_id === input.workItemId) {
              return true;
            }
            return input.includeWorkflowScope === true && brief.work_item_id === null;
          }),
      ),
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
          id: 'packet-intake',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          packet_kind: 'intake',
          source: 'operator',
          summary: 'Selected work-item input',
          structured_inputs: {},
          metadata: {},
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-27T22:32:00.000Z',
          updated_at: '2026-03-27T22:32:00.000Z',
          files: [],
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

    expect(result.final_deliverables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ descriptor_id: 'workflow-deliverable', work_item_id: null }),
        expect.objectContaining({ descriptor_id: 'work-item-deliverable', work_item_id: 'work-item-1' }),
      ]),
    );
    expect(result.final_deliverables).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ descriptor_id: 'other-work-item-deliverable' })]),
    );
    expect(result.working_handoffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'brief-workflow', work_item_id: null }),
        expect.objectContaining({ id: 'brief-work-item', work_item_id: 'work-item-1' }),
      ]),
    );
    expect(result.working_handoffs).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'brief-other' })]),
    );
    expect(result.inputs_and_provenance).toEqual({
      launch_packet: null,
      supplemental_packets: [expect.objectContaining({ id: 'packet-intake' })],
      intervention_attachments: [],
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

    const result = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
    });

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

  it('does not synthesize a workflow final deliverable from an orchestrator brief that only targets a work item', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => []),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-orchestrator-linked-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-orchestrator-linked-1',
          execution_context_id: 'activation-3',
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
          linked_target_ids: ['work-item-1', 'task-1'],
          sequence_number: 3,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-28T20:43:00.000Z',
          updated_at: '2026-03-28T20:43:00.000Z',
        },
      ]),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };
    const workItemSource = {
      listIncompleteWorkItemIds: vi.fn(async () => []),
      listExistingWorkItemIds: vi.fn(async () => ['work-item-32']),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
      undefined,
      workItemSource as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1');

    expect(result.final_deliverables).toEqual([]);
    expect(result.in_progress_deliverables).toEqual([]);
    expect(result.working_handoffs).toEqual([
      expect.objectContaining({
        id: 'brief-orchestrator-linked-1',
        source_role_name: 'Orchestrator',
      }),
    ]);
  });

  it('attributes a workflow-scoped orchestrator completion brief to the selected work item even when the linked targets also include the task', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => []),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-orchestrator-linked-task-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-orchestrator-linked-task-1',
          execution_context_id: 'activation-31',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'completed',
          short_brief: { headline: 'workflow-intake-31 completion packet' },
          detailed_brief_json: {
            headline: 'workflow-intake-31 completion packet',
            summary: 'The orchestrator observed closure after the specialist completed task-31.',
            status_kind: 'completed',
          },
          linked_target_ids: ['workflow-1', 'work-item-31', 'task-31'],
          sequence_number: 31,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-28T20:43:30.000Z',
          updated_at: '2026-03-28T20:43:30.000Z',
        },
      ]),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };
    const workItemSource = {
      listIncompleteWorkItemIds: vi.fn(async () => []),
      listExistingWorkItemIds: vi.fn(async () => ['work-item-31']),
    };

    const service = new WorkflowDeliverablesService(
      deliverableService as never,
      briefService as never,
      inputPacketService as never,
      undefined,
      workItemSource as never,
    );

    const result = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-31',
    });

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'brief:brief-orchestrator-linked-task-1',
        work_item_id: 'work-item-31',
        delivery_stage: 'final',
      }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
  });

  it('rolls up a work-item deliverable synthesized from a workflow-scoped orchestrator brief when the linked targets also include the task', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => []),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-orchestrator-linked-task-2',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-orchestrator-linked-task-2',
          execution_context_id: 'activation-32',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'completed',
          short_brief: { headline: 'workflow-intake-32 completion packet' },
          detailed_brief_json: {
            headline: 'workflow-intake-32 completion packet',
            summary: 'The orchestrator observed closure after the specialist completed task-32.',
            status_kind: 'completed',
          },
          linked_target_ids: ['workflow-1', 'work-item-32', 'task-32'],
          sequence_number: 32,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-28T20:44:30.000Z',
          updated_at: '2026-03-28T20:44:30.000Z',
        },
      ]),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };
    const workItemSource = {
      listIncompleteWorkItemIds: vi.fn(async () => []),
      listExistingWorkItemIds: vi.fn(async () => ['work-item-32']),
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
        descriptor_id: 'brief:brief-orchestrator-linked-task-2',
        work_item_id: 'work-item-32',
        delivery_stage: 'final',
      }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
  });

  it('rolls up final work-item deliverables into workflow scope when no workflow-scoped deliverable exists', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'deliverable-work-item-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'workflow-intake-01 completion packet',
          state: 'final',
          summary_brief: 'Policy assessment is complete and ready for operator review.',
          preview_capabilities: {},
          primary_target: { target_kind: 'inline_summary', label: 'Review completion packet' },
          secondary_targets: [],
          content_preview: {
            summary: 'Policy assessment is complete and ready for operator review.\n\nProduced by: Policy Assessor',
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

    expect(deliverableService.listDeliverables).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      workItemId: undefined,
      includeWorkflowScope: false,
      includeAllWorkItemScopes: true,
      limit: 500,
    });
    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-work-item-1',
        work_item_id: 'work-item-1',
      }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
  });

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

  it('attributes a workflow-scoped orchestrator completion brief to the targeted work item', async () => {
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

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'brief:brief-orchestrator-linked-2',
        work_item_id: 'work-item-2',
        delivery_stage: 'final',
        content_preview: expect.objectContaining({
          summary: expect.stringContaining('Promoted from workflow brief'),
        }),
      }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
    expect(result.final_deliverables).not.toEqual([
      expect.objectContaining({
        content_preview: expect.objectContaining({
          summary: expect.stringContaining('Produced by: Orchestrator'),
        }),
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
    expect(result.all_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-revision-1',
        state: 'superseded',
      }),
    ]);
  });

  it('keeps a stored final work-item packet in final deliverables when the selected work item is still incomplete', async () => {
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

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-current',
        work_item_id: 'work-item-1',
        delivery_stage: 'final',
        state: 'final',
      }),
    ]);
    expect(result.in_progress_deliverables).toEqual([]);
    expect(result.all_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-current',
        work_item_id: 'work-item-1',
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
      }),
    ]);
    expect(result.all_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'deliverable-current',
      }),
    ]);
  });

  it('does not surface a synthesized final brief packet for a reopened active work item', async () => {
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
    expect(result.all_deliverables).toEqual([
      expect.objectContaining({
        descriptor_id: 'brief:brief-revision-1',
        work_item_id: 'work-item-1',
      }),
    ]);
  });
});
