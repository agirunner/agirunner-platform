import { describe, expect, it, vi } from 'vitest';

import { WorkflowDeliverablesService } from '../../../../src/services/workflow-operations/workflow-deliverables-service.js';

describe('WorkflowDeliverablesService', () => {
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

  it('keeps a workflow-scoped orchestrator completion brief in working handoffs for the selected work item even when the linked targets also include the task', async () => {
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

    expect(result.final_deliverables).toEqual([]);
    expect(result.in_progress_deliverables).toEqual([]);
    expect(result.working_handoffs).toEqual([
      expect.objectContaining({
        id: 'brief-orchestrator-linked-task-1',
      }),
    ]);
  });

  it('does not roll up a workflow-scoped orchestrator brief into a workflow deliverable when the linked targets also include the task', async () => {
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

    expect(result.final_deliverables).toEqual([]);
    expect(result.in_progress_deliverables).toEqual([]);
    expect(result.working_handoffs).toEqual([
      expect.objectContaining({
        id: 'brief-orchestrator-linked-task-2',
      }),
    ]);
  });

  it('rolls up in-progress child deliverable briefs into workflow-scope working handoffs', async () => {
    const deliverableService = {
      listDeliverables: vi.fn(async () => []),
    };
    const briefService = {
      listBriefs: vi.fn(async () => [
        {
          id: 'brief-workflow-deliverable-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          task_id: null,
          request_id: 'request-workflow-deliverable-1',
          execution_context_id: 'activation-1',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'orchestrator',
          source_role_name: 'Orchestrator',
          status_kind: 'in_progress',
          short_brief: { headline: 'Workflow packet is still being assembled.' },
          detailed_brief_json: {
            headline: 'Workflow packet is still being assembled.',
            summary: 'The workflow-level deliverable brief should not suppress the child working handoff.',
            status_kind: 'in_progress',
          },
          linked_target_ids: ['workflow-1'],
          sequence_number: 12,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'agent',
          created_by_id: 'agent-1',
          created_at: '2026-03-29T15:16:00.000Z',
          updated_at: '2026-03-29T15:16:00.000Z',
        },
        {
          id: 'brief-work-item-in-progress-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          request_id: 'request-work-item-in-progress-1',
          execution_context_id: 'task-1',
          brief_kind: 'milestone',
          brief_scope: 'deliverable_context',
          source_kind: 'specialist',
          source_role_name: 'Policy Assessor',
          status_kind: 'in_progress',
          short_brief: { headline: 'Policy assessment packet is being prepared.' },
          detailed_brief_json: {
            headline: 'Policy assessment packet is being prepared.',
            summary: 'The specialist has not finalized the deliverable yet, but the working handoff already exists.',
            status_kind: 'in_progress',
          },
          linked_target_ids: ['workflow-1', 'work-item-1', 'task-1'],
          sequence_number: 11,
          related_artifact_ids: [],
          related_output_descriptor_ids: [],
          related_intervention_ids: [],
          canonical_workflow_brief_id: null,
          created_by_type: 'agent',
          created_by_id: 'agent-1',
          created_at: '2026-03-29T15:17:00.000Z',
          updated_at: '2026-03-29T15:17:00.000Z',
        },
      ]),
    };
    const inputPacketService = {
      listWorkflowInputPackets: vi.fn(async () => []),
    };
    const workItemSource = {
      listIncompleteWorkItemIds: vi.fn(async () => ['work-item-1']),
      listExistingWorkItemIds: vi.fn(async () => ['work-item-1']),
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
    expect(result.working_handoffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'brief-workflow-deliverable-1',
          work_item_id: null,
          status_kind: 'in_progress',
        }),
        expect.objectContaining({
          id: 'brief-work-item-in-progress-1',
          work_item_id: 'work-item-1',
          status_kind: 'in_progress',
        }),
      ]),
    );
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

});
