import { describe, expect, it, vi } from 'vitest';

import { createWorkflowHistoryService } from './support.js';

describe('WorkflowHistoryService briefs and packets', () => {
  it('builds newest-first brief packets from briefs, interventions, and inputs without replaying live updates', async () => {
    const { service, briefService, updateService, interventionService, inputPacketService } =
      createWorkflowHistoryService({
        briefService: {
          listBriefs: vi.fn(async () => [
            {
              id: 'brief-1',
              workflow_id: 'workflow-1',
              work_item_id: null,
              task_id: null,
              request_id: 'request-1',
              execution_context_id: 'execution-1',
              brief_kind: 'milestone',
              brief_scope: 'workflow_timeline',
              source_kind: 'orchestrator',
              source_role_name: 'Orchestrator',
              status_kind: 'in_progress',
              short_brief: { headline: 'Release package moved to approval' },
              detailed_brief_json: {
                headline: 'Release package moved to approval',
                status_kind: 'in_progress',
                summary: 'Verification completed and approval is now required.',
              },
              sequence_number: 4,
              related_artifact_ids: [],
              related_output_descriptor_ids: [],
              related_intervention_ids: [],
              canonical_workflow_brief_id: null,
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T22:39:00.000Z',
              updated_at: '2026-03-27T22:39:00.000Z',
            },
          ]),
        },
        interventionService: {
          listWorkflowInterventions: vi.fn(async () => [
            {
              id: 'intervention-1',
              workflow_id: 'workflow-1',
              work_item_id: null,
              task_id: null,
              kind: 'workflow_action',
              origin: 'operator',
              status: 'applied',
              summary: 'Paused workflow for manual review',
              note: null,
              structured_action: {},
              metadata: {},
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T22:38:00.000Z',
              updated_at: '2026-03-27T22:38:00.000Z',
              files: [],
            },
          ]),
        },
        inputPacketService: {
          listWorkflowInputPackets: vi.fn(async () => [
            {
              id: 'packet-1',
              workflow_id: 'workflow-1',
              work_item_id: null,
              packet_kind: 'launch',
              source: 'operator',
              summary: 'Initial launch packet',
              structured_inputs: {},
              metadata: {},
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T22:37:00.000Z',
              updated_at: '2026-03-27T22:37:00.000Z',
              files: [],
            },
            {
              id: 'packet-2',
              workflow_id: 'workflow-1',
              work_item_id: null,
              packet_kind: 'redrive_patch',
              source: 'redrive',
              summary: 'Retry with corrected inputs',
              structured_inputs: {},
              metadata: {},
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T22:36:00.000Z',
              updated_at: '2026-03-27T22:36:00.000Z',
              files: [],
            },
          ]),
        },
      });

    const result = await service.getHistory('tenant-1', 'workflow-1', { limit: 5 });

    expect(result.snapshot_version).toBe('workflow-operations:110');
    expect(result.groups).toEqual([
      expect.objectContaining({
        group_id: '2026-03-27',
        item_ids: ['brief-1', 'intervention-1', 'packet-1', 'packet-2'],
      }),
    ]);
    expect(result.items).toEqual([
      expect.objectContaining({
        item_id: 'brief-1',
        item_kind: 'milestone_brief',
        headline: 'Release package moved to approval',
        source_kind: 'orchestrator',
        source_label: 'Orchestrator',
      }),
      expect.objectContaining({
        item_id: 'intervention-1',
        item_kind: 'intervention',
        headline: 'Paused workflow for manual review',
      }),
      expect.objectContaining({
        item_id: 'packet-1',
        item_kind: 'input',
        headline: 'Initial launch packet',
      }),
      expect.objectContaining({
        item_id: 'packet-2',
        item_kind: 'redrive',
        headline: 'Retry with corrected inputs',
      }),
    ]);
    expect(result.next_cursor).toBeNull();
    expect(result.filters).toEqual({
      available: ['briefs', 'interventions', 'inputs', 'redrives'],
      active: [],
    });
    expect(updateService.listUpdates).not.toHaveBeenCalled();
    expect(briefService.listBriefs).toHaveBeenCalledTimes(1);
    expect(interventionService.listWorkflowInterventions).toHaveBeenCalledTimes(1);
    expect(inputPacketService.listWorkflowInputPackets).toHaveBeenCalledTimes(1);
  });
});
