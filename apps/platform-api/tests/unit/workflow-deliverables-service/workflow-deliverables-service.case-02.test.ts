import { describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverablesService } from '../../../src/services/workflow-operations/workflow-deliverables-service.js';

describe('WorkflowDeliverablesService', () => {
  it('keeps selected work-item deliverables and briefs scoped while leaving inputs scoped', async () => {
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

    expect(result.final_deliverables).toEqual([
      expect.objectContaining({ descriptor_id: 'workflow-deliverable', work_item_id: null }),
      expect.objectContaining({ descriptor_id: 'work-item-deliverable', work_item_id: 'work-item-1' }),
    ]);
    expect(result.final_deliverables).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ descriptor_id: 'other-work-item-deliverable' }),
      ]),
    );
    expect(result.working_handoffs).toEqual([
      expect.objectContaining({ id: 'brief-workflow', work_item_id: null }),
      expect.objectContaining({ id: 'brief-work-item', work_item_id: 'work-item-1' }),
    ]);
    expect(result.working_handoffs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'brief-other' }),
      ]),
    );
    expect(result.inputs_and_provenance).toEqual({
      launch_packet: null,
      supplemental_packets: [expect.objectContaining({ id: 'packet-intake' })],
      intervention_attachments: [],
      redrive_packet: null,
    });
  });

  it('keeps a selected work-item deliverable packet paired with its matching workflow rollup descriptor', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'workflow-rollup-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Blueprint completion packet',
          state: 'final',
          summary_brief: 'Workflow rollup for the completed blueprint work item.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: {
            rollup_source_descriptor_id: 'work-item-deliverable-1',
            rollup_source_work_item_id: 'work-item-1',
          },
          source_brief_id: null,
          created_at: '2026-03-29T18:57:23.564Z',
          updated_at: '2026-03-29T18:57:23.564Z',
        },
        {
          descriptor_id: 'work-item-deliverable-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Blueprint completion packet',
          state: 'final',
          summary_brief: 'Canonical work-item deliverable.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: {},
          source_brief_id: null,
          created_at: '2026-03-29T18:44:23.277Z',
          updated_at: '2026-03-29T18:44:23.277Z',
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

    expect(result.final_deliverables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor_id: 'work-item-deliverable-1',
          work_item_id: 'work-item-1',
        }),
        expect.objectContaining({
          descriptor_id: 'workflow-rollup-1',
          work_item_id: null,
        }),
      ]),
    );
    expect(result.final_deliverables).toHaveLength(2);
  });

  it('keeps direct work-item deliverables visible in workflow scope even when workflow rollups exist', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => [
        {
          descriptor_id: 'workflow-rollup-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Implementation packet',
          state: 'final',
          summary_brief: 'Workflow rollup for the completed work item.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: {
            rollup_source_descriptor_id: 'work-item-deliverable-1',
            rollup_source_work_item_id: 'work-item-1',
          },
          source_brief_id: null,
          created_at: '2026-03-29T20:00:00.000Z',
          updated_at: '2026-03-29T20:00:00.000Z',
        },
        {
          descriptor_id: 'work-item-deliverable-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Implementation packet',
          state: 'final',
          summary_brief: 'Canonical work-item deliverable.',
          preview_capabilities: {},
          primary_target: {},
          secondary_targets: [],
          content_preview: {},
          source_brief_id: null,
          created_at: '2026-03-29T19:58:00.000Z',
          updated_at: '2026-03-29T19:58:00.000Z',
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
          descriptor_id: 'workflow-rollup-1',
          work_item_id: null,
        }),
        expect.objectContaining({
          descriptor_id: 'work-item-deliverable-1',
          work_item_id: 'work-item-1',
        }),
      ]),
    );
  });

});

