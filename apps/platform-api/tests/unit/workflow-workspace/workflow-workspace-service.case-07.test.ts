import { describe, expect, it, vi } from 'vitest';

import { WorkflowWorkspaceService } from '../../../src/services/workflow-operations/workflow-workspace-service.js';

const briefsService = {
  getBriefs: vi.fn(async () => ({
    snapshot_version: 'workflow-operations:120',
    generated_at: '2026-03-27T22:45:00.000Z',
    latest_event_id: 120,
    items: [],
    total_count: 0,
    next_cursor: null,
  })),
};

describe('WorkflowWorkspaceService', () => {
  it('keeps matching workflow rollup deliverables visible in selected work-item scope', async () => {
    const workflowService = {
      getWorkflow: vi.fn(async () => ({})),
      getWorkflowBoard: vi.fn(async () => ({ columns: [], work_items: [] })),
    };
    const railService = {
      getWorkflowCard: vi.fn(async () => ({
        id: 'workflow-1',
        name: 'Release Workflow',
        posture: 'progressing',
        pulse: { summary: 'Shipping outputs' },
        availableActions: [],
        outputDescriptors: [],
        metrics: {
          blockedWorkItemCount: 0,
          openEscalationCount: 0,
          failedTaskCount: 0,
          recoverableIssueCount: 0,
          waitingForDecisionCount: 0,
          activeTaskCount: 1,
          activeWorkItemCount: 1,
          lastChangedAt: '2026-03-29T18:57:23.564Z',
        },
      })),
    };
    const liveConsoleService = {
      getLiveConsole: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-29T18:57:23.564Z',
        latest_event_id: 120,
        items: [],
        next_cursor: null,
        live_visibility_mode: 'enhanced',
      })),
    };
    const historyService = {
      getHistory: vi.fn(async () => ({
        snapshot_version: 'workflow-operations:120',
        generated_at: '2026-03-29T18:57:23.564Z',
        latest_event_id: 120,
        groups: [],
        items: [],
        filters: { available: [], active: [] },
        next_cursor: null,
      })),
    };
    const deliverablesService = {
      getDeliverables: vi.fn(async () => ({
        final_deliverables: [
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
        ],
        in_progress_deliverables: [],
        working_handoffs: [],
        inputs_and_provenance: {
          launch_packet: null,
          supplemental_packets: [],
          intervention_attachments: [],
          redrive_packet: null,
        },
        next_cursor: null,
        all_deliverables: [
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
        ],
      })),
    };
    const interventionService = {
      listWorkflowInterventions: vi.fn(async () => []),
    };
    const steeringSessionService = {
      listSessions: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
    };

    const service = new WorkflowWorkspaceService(
      workflowService as never,
      railService as never,
      liveConsoleService as never,
      historyService as never,
      deliverablesService as never,
      interventionService as never,
      steeringSessionService as never,
      undefined,
      undefined,
      briefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_work_item',
      workItemId: 'work-item-1',
    });

    expect(result.deliverables.final_deliverables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ descriptor_id: 'work-item-deliverable-1', work_item_id: 'work-item-1' }),
        expect.objectContaining({ descriptor_id: 'workflow-rollup-1', work_item_id: null }),
      ]),
    );
    expect(result.deliverables.final_deliverables).toHaveLength(2);
  });

});
