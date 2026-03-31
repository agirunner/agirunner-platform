import { describe, expect, it, vi } from 'vitest';

import { WorkflowWorkspaceService } from '../../../../src/services/workflow-operations/workflow-workspace-service.js';

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
  it('preserves already-scoped live-console packets instead of dropping scoped rows during workspace composition', async () => {
    const service = new WorkflowWorkspaceService(
      {
        getWorkflow: vi.fn(async () => ({
          parameters: {},
          context: {},
          workflow_relations: { parent: null, children: [] },
        })),
        getWorkflowBoard: vi.fn(async () => ({
          columns: [],
          work_items: [{ id: 'work-item-1' }],
        })),
      } as never,
      {
        getWorkflowCard: vi.fn(async () => ({
          id: 'workflow-1',
          name: 'Workflow 1',
          state: 'active',
          posture: 'progressing',
          pulse: { summary: 'Active.' },
          outputDescriptors: [],
          availableActions: [],
          metrics: {
            blockedWorkItemCount: 0,
            openEscalationCount: 0,
            failedTaskCount: 0,
            recoverableIssueCount: 0,
            waitingForDecisionCount: 0,
            activeTaskCount: 1,
            activeWorkItemCount: 1,
            lastChangedAt: '2026-03-28T00:00:00.000Z',
          },
        })),
      } as never,
      {
        getLiveConsole: vi.fn(async () => ({
          snapshot_version: 'workflow-operations:1',
          generated_at: '2026-03-28T00:00:00.000Z',
          latest_event_id: 1,
          items: [{
            item_id: 'execution-log:log-1',
            item_kind: 'execution_turn',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            headline: '[Plan] Waiting on the selected work item response.',
            summary: 'Already scoped upstream.',
            created_at: '2026-03-28T00:00:00.000Z',
            work_item_id: null,
            task_id: null,
            linked_target_ids: [],
            scope_binding: 'execution_context',
          }],
          total_count: 1,
          counts: {
            all: 1,
            turn_updates: 1,
            briefs: 0,
          },
          next_cursor: null,
          scope_filtered: true,
          live_visibility_mode: 'enhanced',
        })),
      } as never,
      {
        getHistory: vi.fn(async () => ({
          snapshot_version: 'workflow-operations:1',
          generated_at: '2026-03-28T00:00:00.000Z',
          latest_event_id: 1,
          groups: [],
          items: [],
          total_count: 0,
          filters: { available: [], active: [] },
          next_cursor: null,
        })),
      } as never,
      {
        getDeliverables: vi.fn(async () => ({
          final_deliverables: [],
          in_progress_deliverables: [],
          working_handoffs: [],
          inputs_and_provenance: {
            launch_packet: null,
            supplemental_packets: [],
            intervention_attachments: [],
            redrive_packet: null,
          },
          next_cursor: null,
          all_deliverables: [],
        })),
      } as never,
      {
        listWorkflowInterventions: vi.fn(async () => []),
      } as never,
      {
        listSessions: vi.fn(async () => []),
        listMessages: vi.fn(async () => []),
      } as never,
      undefined,
      undefined,
      briefsService as never,
    );

    const result = await service.getWorkspace('tenant-1', 'workflow-1', {
      tabScope: 'selected_work_item',
      workItemId: 'work-item-1',
    });

    expect(result.live_console.total_count).toBe(1);
    expect(result.live_console.counts).toEqual({
      all: 1,
      turn_updates: 1,
      briefs: 0,
    });
    expect(result.live_console.items).toEqual([
      expect.objectContaining({
        item_id: 'execution-log:log-1',
      }),
    ]);
  });

});
