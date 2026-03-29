import { describe, expect, it } from 'vitest';

import type { WorkflowDeliverableRecord } from '../../src/services/workflow-deliverable-service.js';
import { WorkflowWorkspaceService } from '../../src/services/workflow-operations/workflow-workspace-service.js';

function buildDeliverable(
  descriptorId: string,
  workItemId: string | null,
): WorkflowDeliverableRecord {
  return {
    descriptor_id: descriptorId,
    workflow_id: 'workflow-1',
    work_item_id: workItemId,
    descriptor_kind: 'deliverable_packet',
    delivery_stage: 'final',
    title: descriptorId,
    state: 'final',
    summary_brief: null,
    preview_capabilities: {},
    primary_target: { target_kind: 'artifact', artifact_id: `${descriptorId}-artifact` },
    secondary_targets: [],
    content_preview: {},
    source_brief_id: null,
    created_at: '2026-03-29T18:00:00.000Z',
    updated_at: '2026-03-29T18:00:00.000Z',
  };
}

function buildWorkspaceService(deliverables: WorkflowDeliverableRecord[]) {
  return new WorkflowWorkspaceService(
    {
      async getWorkflow() {
        return {} as never;
      },
      async getWorkflowBoard() {
        return {
          columns: [],
          work_items: [],
          active_stages: [],
          awaiting_gate_count: 0,
          stage_summary: [],
        };
      },
    },
    {
      async getWorkflowCard() {
        return {
          id: 'workflow-1',
          name: 'Workflow 1',
          posture: 'active',
          state: 'active',
          pulse: { summary: 'Running' },
          metrics: {
            waitingForDecisionCount: 0,
            openEscalationCount: 0,
            blockedWorkItemCount: 0,
            activeTaskCount: 0,
            activeWorkItemCount: 0,
          },
          availableActions: [],
          outputDescriptors: [],
        } as never;
      },
    },
    {
      async getLiveConsole() {
        return {
          generated_at: '2026-03-29T18:00:00.000Z',
          latest_event_id: 1,
          snapshot_version: 'workflow-operations:1',
          items: [],
          total_count: 0,
          counts: { all: 0, turn_updates: 0, briefs: 0 },
          next_cursor: null,
          live_visibility_mode: 'enhanced',
        } as never;
      },
    },
    {
      async getHistory() {
        return {
          generated_at: '2026-03-29T18:00:00.000Z',
          latest_event_id: 1,
          snapshot_version: 'workflow-operations:1',
          items: [],
          total_count: 0,
          counts: { all: 0, interventions: 0, approvals: 0, deliverables: 0, briefs: 0 },
          next_cursor: null,
        } as never;
      },
    },
    {
      async getDeliverables() {
        return {
          final_deliverables: deliverables,
          in_progress_deliverables: [],
          working_handoffs: [],
          inputs_and_provenance: {
            launch_packet: null,
            supplemental_packets: [],
            intervention_attachments: [],
            redrive_packet: null,
          },
          next_cursor: null,
          all_deliverables: deliverables,
        };
      },
    },
    {
      async listWorkflowInterventions() {
        return [];
      },
    },
    {
      async listSessions() {
        return [];
      },
      async listMessages() {
        return [];
      },
    },
  );
}

describe('WorkflowWorkspaceService', () => {
  it('preserves workflow rollup deliverables inside selected work-item scope', async () => {
    const service = buildWorkspaceService([
      buildDeliverable('workflow-rollup', null),
      buildDeliverable('work-item-output', 'work-item-1'),
    ]);

    const workspace = await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_work_item',
      workItemId: 'work-item-1',
    });

    expect(
      (workspace.deliverables.final_deliverables as WorkflowDeliverableRecord[]).map(
        (deliverable) => deliverable.descriptor_id,
      ),
    ).toEqual(['workflow-rollup', 'work-item-output']);
  });

  it('preserves workflow rollup deliverables inside selected task scope', async () => {
    const service = buildWorkspaceService([
      buildDeliverable('workflow-rollup', null),
      buildDeliverable('work-item-output', 'work-item-1'),
    ]);

    const workspace = await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_task',
      workItemId: 'work-item-1',
      taskId: 'task-1',
    });

    expect(
      (workspace.deliverables.final_deliverables as WorkflowDeliverableRecord[]).map(
        (deliverable) => deliverable.descriptor_id,
      ),
    ).toEqual(['workflow-rollup', 'work-item-output']);
  });
});
