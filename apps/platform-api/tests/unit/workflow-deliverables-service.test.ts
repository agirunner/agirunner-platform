import { describe, expect, it } from 'vitest';

import type { WorkflowDeliverableRecord } from '../../src/services/workflow-deliverable-service.js';
import { WorkflowDeliverablesService } from '../../src/services/workflow-operations/workflow-deliverables-service.js';

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

describe('WorkflowDeliverablesService', () => {
  it('keeps workflow rollup deliverables visible when a work item scope is requested', async () => {
    const service = new WorkflowDeliverablesService(
      {
        async listDeliverables() {
          return [
            buildDeliverable('workflow-rollup', null),
            buildDeliverable('work-item-output', 'work-item-1'),
          ];
        },
      },
      {
        async listBriefs() {
          return [];
        },
      },
      {
        async listWorkflowInputPackets() {
          return [];
        },
      },
      {
        async listLatestCompletedWorkItemHandoffs() {
          return [];
        },
      },
      {
        async listIncompleteWorkItemIds() {
          return [];
        },
        async listExistingWorkItemIds() {
          return [];
        },
      },
    );

    const packet = await service.getDeliverables('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      limit: 20,
    });

    expect(
      (packet.final_deliverables as WorkflowDeliverableRecord[]).map(
        (deliverable) => deliverable.descriptor_id,
      ),
    ).toEqual([
      'workflow-rollup',
      'work-item-output',
    ]);
    expect(
      packet.all_deliverables.map((deliverable) => deliverable.descriptor_id),
    ).toEqual([
      'workflow-rollup',
      'work-item-output',
    ]);
  });
});
